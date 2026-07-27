import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MessistantDatabase } from "../src/persistence/database.js";

export function temporaryDatabase(): {
  directory: string;
  database: MessistantDatabase;
  cleanup: () => void;
} {
  const directory = mkdtempSync(path.join(tmpdir(), "messistant-test-"));
  const database = new MessistantDatabase(directory);
  return {
    directory,
    database,
    cleanup() {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
