export const createJob = (runJob: () => any, interval: number): void => {
  setTimeout(async () => {
    await runJob();
    createJob(runJob, interval);
  }, interval);
};
