// await-notify.d.ts

declare module 'await-notify' {
    class Subject {
      message: any;
  
      notify(): void;
      wait(timeout: number): Promise<void>;
    }
  
    export { Subject };
  }