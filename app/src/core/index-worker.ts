// worker_threads entry: {root, paths} -> IndexedFile[]
import { parentPort } from "node:worker_threads";
import { indexBatch } from "./scan";

parentPort?.on("message", async (msg: { root: string; paths: string[] }) => {
  parentPort!.postMessage(await indexBatch(msg.root, msg.paths));
});
