// dist/cli.js entry: `bedrock <command>` (through the installed shim, in Node mode) or
// `node dist/cli.js <command>` in development. `--cli <args>` and `--mcp` are accepted too, so the
// same arguments work here and on the app's executable.
import { runCli } from "./main";

const args = process.argv.slice(2);
if (args[0] === "--cli") args.shift();
const argv = args[0] === "--mcp" ? ["mcp", ...args.slice(1)] : args;
runCli(argv).then(
  (code) => {
    if (argv[0] === "mcp") process.exit(code);
    process.exitCode = code;
  },
  (e) => {
    process.stderr.write(String(e?.stack ?? e) + "\n");
    process.exit(1);
  },
);
