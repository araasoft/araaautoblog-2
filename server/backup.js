// npm run backup  -> writes data/backups/backup-<time>.json (credentials excluded). Restore: see docs/OPERATIONS.md
import "dotenv/config";
import { backup } from "./src/migrate.js";
console.log("Backup written:", await backup());
