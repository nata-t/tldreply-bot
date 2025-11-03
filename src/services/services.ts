import { Database } from '../db/database';
import { EncryptionService } from '../utils/encryption';

// Global instances that conversations can access
export let db: Database | null = null;
export let encryption: EncryptionService | null = null;

export function setServices(database: Database, encryptionService: EncryptionService) {
  db = database;
  encryption = encryptionService;
}
