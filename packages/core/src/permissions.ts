export type PermissionStatus =
  | 'granted'
  | 'denied'
  | 'undetermined'
  | 'restricted'
  | 'blocked';

export interface PermissionsApi {
  check(): Promise<PermissionStatus>;
  request(): Promise<PermissionStatus>;
}
