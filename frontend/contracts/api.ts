// v1.0 wire types. Runtime truth and all timing decisions belong to the backend.
export type Locale = 'zh-CN'|'en';
export interface MessageDetails {message_key?:string;message_params?:Record<string,string|number|boolean|null>}
export interface ReasonDetails {reason_code?:string;reason_params?:Record<string,string|number|boolean|null>}
export type NS = string; // decimal nanoseconds, never convert to JS Number for identity
export type Behavior = 'SEATED'|'NEARBY'|'MISSING'|'ABSENT'|'UNKNOWN';
export type WorkState = 'NOT_STARTED'|'START_PENDING'|'WORKING'|'AWAY_PENDING'|'REST'|'OBSERVATION_UNKNOWN';
export type Action = 'start'|'end'|'review'|'confirm_camera'|'confirm_return';
export type Point = [number, number];
export interface Keypoint { x:number|null; y:number|null; confidence:number|null }
export interface Person {
  person_track_id:number|null; bbox_xyxy:[number,number,number,number]; confidence:number;
  valid:boolean; keypoints:Keypoint[]; upper_body_anchor:Point|null;
  is_session_operator?:boolean;ownership_zone?:'SEATED'|'NEARBY'|'OUTSIDE'|'UNKNOWN';
}
export interface Ownership {
  operator_id:string|null;track_id:number|null;run_id?:string|null;stream_session_id?:string|null;
  state:'UNBOUND'|'CANDIDATE'|'TRACKED'|'MISSING'|'CONFIRMATION_REQUIRED'|'INPUT_UNKNOWN'|'UNVERIFIED'|'ENDED';
  needs_confirmation:boolean;candidates:{track_id:number;bbox_xyxy:[number,number,number,number];zone:'SEATED'}[];
  ignored_track_ids:number[];away_since:number|null;absent_since:number|null;
  away_seconds:number;absent_seconds:number;end_remaining_seconds:number|null;
}
export interface ConfirmReturnRequest {
  action:'confirm_return';session_id:string;observation_id:string;stream_session_id:string;
  config_revision:number;track_id:number;
}
export interface Observation {
 models?:ModelSelection;model_weights?:Record<string,string|null>;materials?:MaterialSettings;
  visualization?:VisualizationSettings;

  ownership?:Ownership;
  config_revision?:number;privacy_applied?:boolean;display?:DisplaySettings;detection?:DetectionSettings;
  observation_id:string; run_id:string;
  frame:{stream_session_id:string;receive_sequence:number;pts_ns:NS|null;receive_monotonic_ns:NS;
    source_width:number;source_height:number;jpeg_width:number;jpeg_height:number;color_format:'BGR'};
  inference:ReasonDetails & {started_monotonic_ns:NS;completed_monotonic_ns:NS;local_processing_ms:number;
    local_receive_to_result_ms:number;accepted:boolean;observation_valid:boolean;behavior:Behavior;reason:string};
  persons:Person[];regions:Record<string,Point[]>;roi_provisional:boolean;camera_changed:boolean;matching_frame_url:string;
}
export interface ObservationEnvelope {
  config_revision?:number;privacy_applied?:boolean;max_observation_age_ms?:number;
  schema_version:'1.0';available:boolean;fresh:boolean;age_ms:number|null;
  algorithm_error:string|null;observation:Observation|null;
}
export interface Camera {
  video?:VideoTransportStatus;
  config_revision?:number;privacy_applied?:boolean;output_fps?:number;algorithm_error?:string|null;regions_match?:boolean;camera_changed?:boolean;
  schema_version:'1.0';status:'connecting'|'online'|'reconnecting';sequence:number;
  width:number|null;height:number|null;jpeg_width:number|null;jpeg_height:number|null;
  source_fps:number|null;stream_session_id:string|null;receive_sequence:number|null;pts_ns:NS|null;age_ms:number|null;
  source_type?:'rtsp'|'usb';device_name?:string;connection_error?:string|null;
  codec:'h264'|'h265'|'yuyv'|'mjpeg';decoder:'nvv4l2decoder'|'software';preview_max_fps:number;preview_has_project_overlay:false;
}
export interface WorkStatus extends ReasonDetails {
  ownership?:Ownership;
  config_revision?:number;privacy_applied?:boolean;
  schema_version:'1.0';state:WorkState;behavior:Behavior;reason:string;run_id:string;
  session_id:string|null;active:boolean;session_start:number|null;session_end:number|null;review:boolean;
  work_seconds:number;rest_seconds:number;unknown_seconds:number;pending_seconds:number;
  start_pending_seconds:number;completed_sessions:number;thresholds:Record<string,unknown>;
  frame_ref:{session_id?:string;receive_sequence?:number;pts_ns?:NS|null;receive_monotonic_ns?:NS};
  algorithm_error:string|null;roi_provisional:boolean;camera_changed:boolean;regions:Record<string,Point[]>;
  image_size:Point;last_observation_monotonic_seconds:number|null;server_monotonic_seconds:number;server_wall_time_ms:number;
}
export interface ApiError {schema_version:'1.0';error:MessageDetails & {code:string;message:string}}

export interface VisualizationSettings {colors:Record<'station'|'seat'|'person'|'skeleton'|'keypoint'|'anchor',string>;station_fill_alpha:number;seat_fill_alpha:number}
export interface VideoTransportStatus {streams?:('zh-CN'|'en'|'raw')[];webrtc_available:boolean;profiles?:Record<string,{width:number;max_fps:number;bitrate:number}>;viewers?:number;preview:{width:number;max_fps:number;bitrate:number};fallback:{width:number;max_fps:number;jpeg_quality:number};error:string|null;epoch:number}
export interface DisplaySettings {boxes:boolean;regions:boolean;keypoints:boolean;station?:boolean;seat?:boolean}
export interface TimingSettings {start_seconds:number;short_away_seconds:number;stop_absent_seconds:number;missing_grace_seconds:number;max_observation_age:number}
export interface DetectionSettings {person_confidence:number;keypoint_confidence:number}
export interface DeviceSettings {
  models:ModelSelection;materials:MaterialSettings;
  visualization?:VisualizationSettings;visualization_defaults?:VisualizationSettings;
  detection?:DetectionSettings;detection_defaults?:DetectionSettings;
  schema_version:'1.0';revision:number;privacy:{enabled:boolean};display:DisplaySettings;
  timing:TimingSettings;defaults:TimingSettings;regions:{station:Point[];seat:Point[]};
  image_size:Point;roi_configured:boolean;camera:Camera;camera_source?:CameraSource;
}
export interface SettingsUpdate {
  models?:ModelSelection;materials?:MaterialSettings;
  visualization?:VisualizationSettings;
  detection?:DetectionSettings;
  camera_source?:CameraSourceInput;test_token?:string;
  expected_revision:number;privacy?:{enabled:boolean};display?:DisplaySettings;timing?:TimingSettings;
  regions?:{station:Point[];seat:Point[]};image_size?:Point;
  reference_frame?:{stream_session_id:string;image_size:Point;camera_changed?:boolean};
}

export interface SystemMetrics {
  schema_version:'1.0';
  sampled_at_ms:number;
  age_ms:number;
  cpu_percent:number|null;
  gpu_percent:number|null;
  memory_used_bytes:number|null;
  memory_total_bytes:number|null;
  temperature_celsius:number|null;
  temperature_sensor:string|null;
  uptime_seconds:number|null;
}

export type UsbFormat = 'yuyv'|'mjpeg'|'h264';
export type CameraSource = {type:'rtsp';url:string;username:string;codec:'h264'|'h265';password_set:boolean}|{type:'usb';device:string;format:UsbFormat};
export type CameraSourceInput = {type:'rtsp';url:string;username:string;codec:'h264'|'h265';password?:string}|{type:'usb';device:string;format:UsbFormat};
export interface CameraDevices {schema_version:'1.0';devices:{device:string;name:string;formats:UsbFormat[]}[]}
export interface CameraTestRequest {expected_revision:number;camera_source:CameraSourceInput}
export interface CameraTestResult {schema_version:'1.0';test_token:string;expires_in_seconds:number;width:number;height:number}

// Device-local material counting and training studio.
export interface ModelSelection {person:string;material:string|null}
export interface MaterialSettings {
 enabled:boolean;configured:boolean;class_id:number;confidence:number;stable_seconds:number;
 missing_seconds:number;sample_hz:number;regions:{pending:Point[];completed:Point[]};
 display:{pending:boolean;completed:boolean};colors:{pending:string;completed:string};opacity:{pending:number;completed:number};
}
export interface RegisteredModel {id:string;revision:number;name:string;role:'person'|'material';task:'pose'|'detect';classes:Record<string,string>;sha256:string|null;builtin:boolean;installed:boolean;source:'builtin'|'upload'|'official'|'trained'}
export interface Dataset {id:string;revision:number;name:string;class_name:string;images?:DatasetImage[]}
export interface DatasetImage {id:string;dataset_id:string;revision:number;group_id:string;width:number;height:number;boxes:[number,number,number,number][];annotated:boolean;privacy_applied:boolean;config_revision:number}
export interface DatasetSnapshot {id:string;dataset_id:string;dataset_revision:number;sha256:string;counts:{train:number;val:number;test:number};ratios:[number,number,number];seed:42}
export type TrainingState='queued'|'preparing'|'running'|'validating'|'saving'|'stopping'|'completed'|'paused'|'interrupted'|'failed'|'cancelled';
export interface TrainingJob {batch_index?:number;batches_total?:number;losses?:Record<string,number>;peak_memory_allocated_bytes?:number;id:string;revision:number;control_revision:number;state:TrainingState;stage:string;epoch:number;progress:number;snapshot_id:string;base_model_id:string;parameters:{epochs:number;lr0:number;batch:number;optimizer:'AdamW';imgsz:640;workers:0;seed:42;patience:20;device:0;amp:boolean};metrics:Record<string,number>;test_metrics?:Record<string,number>;elapsed_seconds?:number;eta_seconds?:number;checkpoint:string|null;result_model_id?:string;error:string|null;log?:string}
export interface MaterialEvent {id:string;session_id:string;kind:string;delta:number;timestamp:number;reason?:string;event_id?:string;before?:number;after?:number;config_revision?:number;model_id?:string;model_sha256?:string;stream_session_id?:string;frame_sequence?:number}
export interface MaterialStatus {enabled:boolean;available:boolean;initialized:boolean;pending:number|null;completed:number|null;cumulative:number;session_id:string|null;reviews:MaterialEvent[];age_ms:number|null}
