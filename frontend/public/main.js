import {applyVisualization} from './overlay.js';
import {VideoPlayer} from './video-player.js';
import {getJSON, workAction, duration, dashboardView, displayMode, systemMetricsView, currentObservation, matchingImage, drawResult} from './api.js';
import {tr, text, getLanguage, errorDetails} from './i18n.js';
import {pipelineState} from './pipeline.js';

const $ = id => document.getElementById(id);
function setValue(id,value) { if ($(id).textContent !== value) $(id).textContent = value; }
function fitVideoFrame() {
  if (document.fullscreenElement) return;
  const dashboard = document.querySelector('.dashboard');
  const card = document.querySelector('.video-card');
  const viewport = $('viewport');
  // Measure the normal responsive grid before fitting. This avoids resize drift.
  dashboard.removeAttribute('data-frame-fit');
  card.style.removeProperty('height');
  card.style.removeProperty('width');
  card.style.removeProperty('justify-self');
  const columns = getComputedStyle(dashboard).gridTemplateColumns.split(' ');
  const frame = viewport.getBoundingClientRect();
  const cardBox = card.getBoundingClientRect();
  const borderWidth = cardBox.width-card.clientWidth;
  const chromeHeight = cardBox.height-frame.height;
  const feed = $('feed');
  const aspect = feed.videoWidth > 0 ? feed.videoWidth/feed.videoHeight : 16/9;
  const width = Math.min(frame.width, frame.height*aspect);
  if (width <= 0) return;
  if (columns.length === 2) {
    dashboard.style.setProperty('--video-column-width', (width+borderWidth)+'px');
    dashboard.dataset.frameFit = 'true';
  } else {
    card.style.width = (width+borderWidth)+'px';
    card.style.justifySelf = 'center';
  }
  card.style.height = (width/aspect+chromeHeight)+'px';
}
new ResizeObserver(() => requestAnimationFrame(fitVideoFrame)).observe(document.querySelector('.dashboard'));
document.addEventListener('fullscreenchange', () => requestAnimationFrame(fitVideoFrame));
let paused = false;
let started = false;
let frameReady = false;
let revision = null;
let streamSession = null;
let cameraOnline = false;
let outputReady = false;
let actionPending = false;
let roiConfigured = null;
let lastStatus = null;
const ownershipDialog = $('ownershipDialog');
let ownershipEvidence = null;
let ownershipSession = null;
let ownershipRequest = 0;
let ownershipTimer = null;
let ownershipSubmitting = false;

function selectedOperator() {
  return $('ownershipCandidates').querySelector('input:checked')?.value;
}
function invalidateOwnershipEvidence() {
  ownershipEvidence = null;
  $('submitOwnership').disabled = true;
}
async function refreshOwnership() {
  clearTimeout(ownershipTimer);
  const request = ++ownershipRequest;
  try {
    const [camera, work, envelope] = await Promise.all([
      getJSON('/api/v1/camera'), getJSON('/api/v1/work/status'), getJSON('/api/v1/observations/latest')]);
    if (!ownershipDialog.open || request !== ownershipRequest) return;
    if (!work.active || work.session_id !== ownershipSession || !work.ownership?.needs_confirmation
        || !currentObservation(camera,envelope)) throw new Error('stale confirmation');
    const observation = envelope.observation;
    const image = await matchingImage(observation);
    if (!ownershipDialog.open || request !== ownershipRequest) return;
    const selected = selectedOperator();
    const focusedTrack=document.activeElement?.name==='operator'?document.activeElement.value:null;
    drawResult($('ownershipCanvas'),image,observation);
    const ctx = $('ownershipCanvas').getContext('2d');
    const scale = image.naturalWidth/observation.frame.source_width;
    const candidates = observation.ownership?.candidates || [];
    const fieldset = $('ownershipCandidates');
    fieldset.replaceChildren();
    const legend = document.createElement('legend');
    legend.textContent = tr('ownership.choose');
    fieldset.append(legend);
    for (const candidate of candidates) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type='radio'; input.name='operator'; input.value=String(candidate.track_id);
      input.checked=input.value===selected;
      const name=document.createElement('span');
      name.textContent=tr('ownership.candidate',{track_id:candidate.track_id});
      label.append(input,name);fieldset.append(label);
      const [x,y,right,bottom]=candidate.bbox_xyxy.map(v=>v*scale);
      const palette=getComputedStyle(document.documentElement);
      const warning=palette.getPropertyValue('--warning').trim();
      const background=palette.getPropertyValue('--bg').trim();
      ctx.strokeStyle=warning;ctx.lineWidth=3;
      ctx.strokeRect(x,y,right-x,bottom-y);
      ctx.font='bold 18px sans-serif';ctx.fillStyle=background;
      const caption=tr('ownership.candidate',{track_id:candidate.track_id});
      const captionY=Math.max(24,y);
      ctx.fillRect(x,captionY-23,ctx.measureText(caption).width+12,26);
      ctx.fillStyle=warning;ctx.fillText(caption,x+6,captionY-4);
      if(input.value===focusedTrack)input.focus({preventScroll:true});
    }
    ownershipEvidence={session_id:work.session_id,observation_id:observation.observation_id,
      stream_session_id:observation.frame.stream_session_id,config_revision:observation.config_revision};
    $('submitOwnership').disabled=ownershipSubmitting || !selectedOperator();
    if (!candidates.length) text('ownershipResult','ownership.noCandidates');
    else $('ownershipResult').textContent='';
  } catch (error) {
    if (request !== ownershipRequest) return;
    invalidateOwnershipEvidence();
    text('ownershipResult','ownership.staleConfirmation');
  } finally {
    if (ownershipDialog.open && request===ownershipRequest && !ownershipSubmitting)
      ownershipTimer=setTimeout(refreshOwnership,750);
  }
}
$('confirmReturn').onclick=()=>{
  ownershipSession=lastStatus?.work.session_id;
  invalidateOwnershipEvidence();
  $('actions').hidePopover();
  ownershipDialog.showModal();
  refreshOwnership();
};
$('closeOwnership').onclick=()=>ownershipDialog.close();
ownershipDialog.addEventListener('close',()=>{
  clearTimeout(ownershipTimer);ownershipRequest++;invalidateOwnershipEvidence();
  $('confirmReturn').focus();
});
$('refreshOwnership').onclick=refreshOwnership;
$('ownershipCandidates').onchange=()=>{
  $('submitOwnership').disabled=ownershipSubmitting || !ownershipEvidence || !selectedOperator();
};
$('submitOwnership').onclick=async()=>{
  if (!ownershipEvidence || !selectedOperator() || ownershipSubmitting) return;
  ownershipSubmitting=true;clearTimeout(ownershipTimer);ownershipRequest++;
  $('submitOwnership').disabled=true;
  try {
    await workAction('confirm_return',{...ownershipEvidence,track_id:Number(selectedOperator())});
    ownershipDialog.close();
    text('actionResult','ownership.confirmed');
  } catch (error) {
    invalidateOwnershipEvidence();
    const details=errorDetails(error);text('ownershipResult',details.key,details.params);
  } finally {
    ownershipSubmitting=false;
    if (ownershipDialog.open) ownershipTimer=setTimeout(refreshOwnership,750);
  }
};
let mode = 'standard';
try { mode = displayMode(localStorage.getItem('worktime.displayMode')); } catch {}
function applyMode(value) {
  mode = displayMode(value);
  document.body.dataset.mode = mode;
  $('modeToggle').setAttribute('aria-pressed', String(mode === 'showcase'));
  text('modeLabel', mode === 'showcase' ? 'v4.exitShowcase' : 'v4.showcase');
  requestAnimationFrame(fitVideoFrame);
}
applyMode(mode);
$('modeToggle').onclick = () => {
  applyMode(mode === 'standard' ? 'showcase' : 'standard');
  try { localStorage.setItem('worktime.displayMode',mode); } catch {}
};
window.addEventListener('storage', event => {
  if (event.key === 'worktime.displayMode') applyMode(event.newValue);
});
const statsDialog = $('statsDialog');
$('statsToggle').onclick = () => statsDialog.showModal();
$('closeStats').onclick = () => statsDialog.close();
statsDialog.addEventListener('click', event => {
  if (event.target !== statsDialog) return;
  const r = statsDialog.getBoundingClientRect();
  if(event.clientX<r.left || event.clientX>r.right || event.clientY<r.top || event.clientY>r.bottom)statsDialog.close();
});
statsDialog.addEventListener('close',()=> $('statsToggle').focus());
$('monitorNav').onclick = () => $('viewport').focus({preventScroll:true});
$('viewport').tabIndex = -1;
let settingsInvoker = $('settingsToggle');
function focusSettingsSection() {
  if(settingsInvoker.dataset.settingsSection !== 'roi') {
    settingsFrame.contentDocument?.querySelector('main')?.scrollTo({top:0});
    return;
  }
  const panel=settingsFrame.contentDocument?.getElementById('editorPanel');
  panel?.scrollIntoView({block:'start'});
  const control=settingsFrame.contentDocument?.getElementById('refreshFrame');
  control?.focus({preventScroll:true});
}
function renderDashboard() {
  const view = dashboardView(lastStatus?.camera,lastStatus?.work,lastStatus?.envelope);
  for(const key of ['work','rest','pending','unknown']) {
    const ratio=view.ratios[key];
    text(key+'Ratio', 'v4.percent', {value:ratio===null?'—':Math.round(ratio)});
    if(ratio===null) { $(key+'Ratio').textContent='—'; delete $(key+'Ratio').dataset.i18n; }
    if(key!=='unknown') $(key+'Bar').style.transform='scaleX('+((ratio??0)/100)+')';
    const value=view.seconds[key]===null?'—':duration(view.seconds[key]);
    setValue('stats'+key[0].toUpperCase()+key.slice(1),value);
    if(key==='work')setValue('workTotal',value);
    setValue({work:'workTime',rest:'restTime',pending:'pendingTime',unknown:'unknownTime'}[key],value);
  }
  for(const id of ['sessionScope','statsScope'])text(id,view.scope);
  for(const [id,value,message] of [['healthFps',view.outputFps,'v4.fpsValue'],['healthProcessing',view.processingMs,'v4.msValue'],['healthAge',view.ageMs,'v4.msValue']]) {
    if(value===null){$(id).textContent='—';delete $(id).dataset.i18n;}
    else text(id,message,{value:Number(value.toFixed(1))});
  }
  const camera=lastStatus?.camera;
  if(camera?.status==='online')text('inputInfo','v4.inputInfo',{width:camera.width,height:camera.height,fps:camera.source_fps??'—'});
  else { $('inputInfo').textContent='—';delete $('inputInfo').dataset.i18n; }
  const state=pipelineState(camera||{},lastStatus?.work||{});
  const tone=state.tone||'idle';
  if(document.body.dataset.tone!==tone)document.body.dataset.tone=tone;
}

function renderSystemMetrics(metrics) {
  const view = systemMetricsView(metrics);
  const gibibyte = 1024 ** 3;
  const memory = view.memoryUsed === null ? '—' :
    (view.memoryUsed/gibibyte).toFixed(1)+' / '+(view.memoryTotal/gibibyte).toFixed(1)+' GiB';
  const values = [
    ['systemCpu', view.cpu === null ? '—' : view.cpu.toFixed(1)+'%', 'system.cpuHint'],
    ['systemGpu', view.gpu === null ? '—' : view.gpu.toFixed(1)+'%', 'system.gpuHint'],
    ['systemMemory', memory, 'system.memoryHint'],
    ['systemTemperature', view.temperature === null ? '—' : view.temperature.toFixed(1)+'°C', 'system.temperatureHint'],
  ];
  for (const [id, value, hint] of values) {
    setValue(id, value);
    const card = $(id).closest('.hardware-metric');
    const key = value === '—' ? 'system.unavailable' : hint;
    card.dataset.i18nTitle = key;
    card.title = tr(key);
  }
  setValue('systemUptime', view.uptime === null ? '—' : duration(view.uptime));
}

async function updateSystemMetrics() {
  try {
    renderSystemMetrics(await getJSON('/api/v1/system/metrics', {signal:AbortSignal.timeout(2000)}));
  } catch {
    renderSystemMetrics(null);
  }
  setTimeout(updateSystemMetrics, 2000);
}


function textPause() {
  const label=$('pause').querySelector('[data-i18n]');
  label.dataset.i18n=paused?'video.resume':'video.pause';
  label.textContent=tr(label.dataset.i18n);
}
const player = new VideoPlayer($('feed'),$('feedFallback'),(ready,retry=false) => {
  frameReady=ready;
  if (retry) started=false;
  if (ready) requestAnimationFrame(fitVideoFrame);
  $('empty').hidden=!paused && outputReady && ready;
});
function resetStream() {
  player.stop();
  started = false;
  frameReady = false;
  streamSession = null;
}
function connect() {
  if (!paused && !document.hidden && outputReady && !started) {
    streamSession = lastStatus?.camera.stream_session_id ?? null;
    started = true;
    player.start(getLanguage(),lastStatus?.camera.video?.webrtc_available === true);
  }
}
document.addEventListener('visibilitychange', () => {
  resetStream();
  if (!document.hidden) connect();
});
window.addEventListener('pagehide', () => resetStream());
$('pause').onclick = () => {
  paused = !paused;
  textPause();
  $('pause').setAttribute('aria-pressed', String(paused));
  $('snapshot').disabled = paused || !outputReady;
  if (paused) {
    resetStream();
    $('empty').hidden = false;
    text('emptyTitle', 'video.paused');
    text('emptyHint', 'video.background');
  } else { render(); connect(); }
};
$('snapshot').onclick = () => {
  const link = document.createElement('a');
  link.href = '/api/frame.jpg?lang=' + getLanguage() + '&t=' + Date.now();
  link.download = 'worktime-camera.jpg';
  link.click();
};
$('fullscreen').onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await $('viewport').requestFullscreen();
  } catch { text('streamInfo', 'video.noFullscreen'); }
};
$('exitFullscreen').onclick = $('fullscreen').onclick;
const helpDialog = $('helpDialog');
$('help').onclick = () => {
  $('actions').hidePopover();
  helpDialog.showModal();
};
$('closeHelp').onclick = () => helpDialog.close();
helpDialog.addEventListener('click', event => {
  if (event.target !== helpDialog) return;
  const rect = helpDialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) helpDialog.close();
});
helpDialog.addEventListener('close', () => $('help').focus());
const settingsDialog = $('settingsDialog');
const settingsFrame = $('settingsFrame');
for (const button of document.querySelectorAll('[data-open-settings]')) {
  button.onclick = () => {
    settingsInvoker = button;
    if (helpDialog.open) helpDialog.close();
    $('actions').hidePopover();
    settingsDialog.showModal();
    if (!settingsFrame.hasAttribute('src')) settingsFrame.src = '/settings?embedded=1';
    else { settingsFrame.contentWindow.dispatchEvent(new Event('resize')); focusSettingsSection(); }
  };
}
$('closeSettings').onclick = () => settingsDialog.close();
settingsDialog.addEventListener('click', event => {
  if (event.target !== settingsDialog) return;
  const rect = settingsDialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) settingsDialog.close();
});
settingsDialog.addEventListener('close', () => settingsInvoker.focus());
settingsFrame.addEventListener('load', () => {
  focusSettingsSection();
  // Keyboard events in the embedded settings document do not bubble to the homepage.
  settingsFrame.contentDocument.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented || document.fullscreenElement) return;
    event.preventDefault();
    settingsDialog.close();
  });
});
$('actions').addEventListener('toggle', event => {
  if (event.newState === 'closed' && $('actions').contains(document.activeElement)) $('more').focus();
});
for (const button of document.querySelectorAll('[data-action]')) {
  button.onclick = async () => {
    actionPending = true;
    for (const control of document.querySelectorAll('[data-action]')) control.disabled = true;
    try {
      await workAction(button.dataset.action);
      text('actionResult', 'actions.recorded');
    } catch (error) { const details = errorDetails(error); text('actionResult', details.key, details.params); }
    finally { actionPending = false; }
  };
}
$('scenario').onchange = async () => {
  try {
    await getJSON('/mock/scenario?name=' + $('scenario').value);
    resetStream();
  } catch (error) { const details = errorDetails(error); text('actionResult', details.key, details.params); }
};
function renderPipeline(camera, work) {
  const state = pipelineState(camera, work);
  $('pipeline').classList.toggle('unavailable', !state.phase);
  for (const item of $('pipeline').children) {
    const active = item.dataset.phase === state.phase;
    item.classList.toggle('active', active);
    if (active) item.setAttribute('aria-current', 'step');
    else item.removeAttribute('aria-current');
    const detail = item.querySelector('.phase-detail');
    if (!active && detail.textContent) {
      delete detail.dataset.i18n;
      delete detail.dataset.i18nParams;
      detail.textContent = '';
    }
  }
  if (state.phase === 'start') text('phase-start-detail', 'pipeline.startProgress', {elapsed:Math.floor(work.start_pending_seconds), target:work.thresholds.start_seconds});
  if (state.phase === 'pause') text('phase-pause-detail', work.state === 'AWAY_PENDING' ? 'pipeline.away' : 'state.rest');
  if (state.phase === 'done') text('phase-done-detail', 'state.done');
  if (state.phase === 'idle') text('phase-idle-detail', 'pipeline.waiting');
  if (state.phase === 'working') text('phase-working-detail', 'pipeline.workingHint');
  text('workState', state.key);
  const className='state ' + state.tone;
  if($('workState').className!==className)$('workState').className=className;
}
function render() {
  renderDashboard();
  textPause();
  if (!lastStatus) {
    text('operatorIdentity','ownership.unbound');
    $('ownershipProgress').hidden=true;
    text('emptyTitle', 'camera.deviceLost');
    text('emptyHint', 'camera.retryHint');
    text('connection', 'camera.deviceOffline');
    text('privacy', 'privacy.pending');
    text('streamInfo', 'camera.waitDevice');
    text('workState', 'camera.deviceOffline');
    text('reason', 'camera.waitDevice');
    text('sessionTimes', 'session.syncPending');
    $('workState').className = 'state offline';
    renderPipeline({status:'offline'}, {});
    text('workState', 'camera.deviceOffline');
    return;
  }
  const {camera, work} = lastStatus;
  const owner=work.ownership;
  if(owner?.operator_id)text('operatorIdentity','ownership.operator',{
    operator:owner.operator_id.slice(0,8),track_id:owner.track_id??'—'});
  else text('operatorIdentity','ownership.unbound');
  $('ownershipProgress').hidden=!work.active || owner?.end_remaining_seconds==null;
  if(!$('ownershipProgress').hidden)text('ownershipProgress','ownership.progress',{
    elapsed:duration(owner.absent_seconds),remaining:duration(Math.ceil(owner.end_remaining_seconds))});
  $('setupNotice').hidden = roiConfigured ?? !work.roi_provisional;
  text('connection', cameraOnline ? 'camera.connected' : 'camera.disconnected');
  $('connection').classList.toggle('online', cameraOnline);
  text('privacy', camera.privacy_applied ? 'privacy.on' : 'privacy.off');
  if (cameraOnline) { $('streamInfo').textContent=player.summary(); delete $('streamInfo').dataset.i18n; }
  else text('streamInfo', 'camera.waiting');
  text('deviceInfo', 'config.version', {revision:camera.config_revision ?? 0});
  if (paused) {
    $('empty').hidden = false;
    text('emptyTitle', 'video.paused');
    text('emptyHint', 'video.background');
  } else {
    $('empty').hidden = outputReady && frameReady;
    text('emptyTitle', camera.algorithm_error ? 'camera.algorithmRecovering' : cameraOnline ? 'camera.preparing' : 'camera.deviceLost');
    text('emptyHint', 'camera.recoveryHint');
  }
  renderPipeline(camera, work);
  if (camera.camera_changed || work.camera_changed || camera.regions_match === false) text('reason', 'camera.moved');
  else if (camera.algorithm_error) text('reason', 'camera.algorithmHint');
  else if (!cameraOnline) text('reason', 'camera.retrying');
  else text('reason', work.reason_code || 'reason.unknown', work.reason_params || {});
  const wallTime = time => new Date(work.server_wall_time_ms + (time - work.server_monotonic_seconds) * 1000).toLocaleTimeString(getLanguage(), {hour12:false});
  if (work.session_start != null) {
    const started = tr('session.started', {time:wallTime(work.session_start)});
    $('sessionTimes').textContent = started + (work.session_end != null ? tr('session.endedAt', {time:wallTime(work.session_end)}) : '');
    delete $('sessionTimes').dataset.i18n;
  } else text('sessionTimes', 'session.autoStart', {seconds:work.thresholds.start_seconds});
  text('timingHelp', 'timing.help', work.thresholds);
}
async function update() {
  try {
    const [camera, work, envelope] = await Promise.all([getJSON('/api/v1/camera'), getJSON('/api/v1/work/status'), getJSON('/api/v1/observations/latest',{signal:AbortSignal.timeout(1000)}).catch(() => null)]);
    cameraOnline = camera.status === 'online';
    outputReady = currentObservation(camera, envelope) && (camera.output_fps === undefined || camera.output_fps > 0);
    if (streamSession !== null && streamSession !== camera.stream_session_id) resetStream();
    if (revision !== camera.config_revision) {
      resetStream();
      try {
        const settings = await getJSON('/api/v1/settings');
        if (settings.revision === camera.config_revision) {
          revision = settings.revision;
          applyVisualization(settings.visualization);
          roiConfigured = settings.roi_configured;
        }
      } catch { roiConfigured = null; }
    }
    lastStatus = {camera, work, envelope};
    if (!outputReady) resetStream();
    connect();
    render();
    $('snapshot').disabled = paused || !outputReady;
    document.querySelector('[data-action="start"]').disabled = actionPending || !outputReady || work.active || work.behavior !== 'SEATED';
    document.querySelector('[data-action="end"]').disabled = actionPending || !work.active;
    document.querySelector('[data-action="review"]').disabled = actionPending || !work.session_id;
    document.querySelector('[data-action="confirm_camera"]').disabled = actionPending || !outputReady;
    $('confirmReturn').disabled=actionPending || !outputReady || !work.active || !work.ownership?.needs_confirmation;
  } catch {
    cameraOnline = false;
    outputReady = false;
    lastStatus = null;
    resetStream();
    $('empty').hidden = false;
    $('connection').classList.remove('online');
    render();
    for (const id of ['workTime','restTime','pendingTime','unknownTime']) $(id).textContent = '—';
    for (const button of document.querySelectorAll('[data-action]')) button.disabled = true;
    $('snapshot').disabled = true;
    $('confirmReturn').disabled=true;
  }
  setTimeout(update, 1000);
}
window.addEventListener('languagechange', () => {
  resetStream();
  render();
  connect();
  requestAnimationFrame(fitVideoFrame);
});
try {
  const info = await getJSON('/dev-info');
  $('mockControls').hidden = info.mode !== 'mock';
} catch { /* Device versions without dev-info still use the monitoring APIs. */ }
update();
updateSystemMetrics();
