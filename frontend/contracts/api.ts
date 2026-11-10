// v1.0 wire types. Runtime truth and all timing decisions belong to the backend.
export type Locale = 'zh-CN'|'en';
export interface MessageDetails {message_key?:string;message_params?:Record<string,string|number|boolean|null>}
export interface ReasonDetails {reason_code?:string;reason_params?:Record<string,string|number|boolean|null>}
export type NS = string; // decimal nanoseconds, never convert to JS Number for identity
export type Behavior = 'SEATED'|'NEARBY'|'MISSING'|'ABSENT'|'UNKNOWN';
export type WorkState = 'NOT_STARTED'|'START_PENDING'|'WORKING'|'AWAY_PENDING'|'REST'|'OBSERVATION_UNKNOWN';
export type Action = 'start'|'end'|'review'|'confirm_camera';
export type Point = [number, number];
export interface Keypoint { x:number|null; y:number|null; confidence:number|null }
export interface Person {
  person_track_id:number|null; bbox_xyxy:[number,number,number,number]; confidence:number;
  valid:boolean; keypoints:Keypoint[]; upper_body_anchor:Point|null;
}
export interface Observation {
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
  config_revision?:number;privacy_applied?:boolean;output_fps?:number;algorithm_error?:string|null;regions_match?:boolean;camera_changed?:boolean;
  schema_version:'1.0';status:'connecting'|'online'|'reconnecting';sequence:number;
  width:number|null;height:number|null;jpeg_width:number|null;jpeg_height:number|null;
  source_fps:number|null;stream_session_id:string|null;receive_sequence:number|null;pts_ns:NS|null;age_ms:number|null;
  source_type?:'rtsp'|'usb';device_name?:string;connection_error?:string|null;
  codec:'h264'|'h265'|'yuyv'|'mjpeg';decoder:'nvv4l2decoder'|'software';preview_max_fps:number;preview_has_project_overlay:false;
}
export interface WorkStatus extends ReasonDetails {
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

export interface DisplaySettings {boxes:boolean;regions:boolean;keypoints:boolean}
export interface TimingSettings {start_seconds:number;short_away_seconds:number;stop_absent_seconds:number;missing_grace_seconds:number;max_observation_age:number}
export interface DetectionSettings {person_confidence:number;keypoint_confidence:number}
export interface DeviceSettings {
  detection?:DetectionSettings;detection_defaults?:DetectionSettings;
  schema_version:'1.0';revision:number;privacy:{enabled:boolean};display:DisplaySettings;
  timing:TimingSettings;defaults:TimingSettings;regions:{station:Point[];seat:Point[]};
  image_size:Point;roi_configured:boolean;camera:Camera;camera_source?:CameraSource;
}
export interface SettingsUpdate {
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
