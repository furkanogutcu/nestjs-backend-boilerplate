export interface IPendingDeferral {
  timer: NodeJS.Timeout;
  resume: () => void;
}
