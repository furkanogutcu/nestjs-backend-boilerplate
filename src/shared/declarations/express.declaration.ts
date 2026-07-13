declare module 'express' {
  // eslint-disable-next-line @typescript-eslint/naming-convention -- augmenting Express' Request interface
  interface Request {
    context: {
      ipAddress: string;
      timestamp: number;
    };
    user?: {
      id: string;
    };
    session?: {
      id: string;
      familyId: string;
    };
  }
}
