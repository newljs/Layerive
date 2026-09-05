import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export const APP_ROOT = path.resolve(import.meta.dirname, '..');
export const DATA_ROOT = path.join(APP_ROOT, 'data');
export const PROJECTS_ROOT = path.join(DATA_ROOT, 'projects');
export const GALLERY_ROOT = path.join(DATA_ROOT, 'gallery');
mkdirSync(PROJECTS_ROOT, { recursive: true });
mkdirSync(GALLERY_ROOT, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_ROOT, 'app.db'));
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    cover_image_id TEXT,
    default_model_id TEXT,
    current_version_id TEXT,
    current_image_id TEXT,
    draft_json TEXT NOT NULL DEFAULT '{}',
    is_favorite INTEGER NOT NULL DEFAULT 0,
    deleted_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    role TEXT NOT NULL,
    message_type TEXT NOT NULL,
    content_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id)
  );
  CREATE TABLE IF NOT EXISTS generation_tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    user_message_id TEXT,
    operation_type TEXT NOT NULL,
    model_id TEXT NOT NULL,
    model_snapshot_json TEXT NOT NULL,
    params_json TEXT NOT NULL,
    input_json TEXT NOT NULL,
    status TEXT NOT NULL,
    error_json TEXT,
    started_at TEXT,
    finished_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id)
  );
  CREATE TABLE IF NOT EXISTS image_versions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    task_id TEXT,
    parent_version_id TEXT,
    version_number INTEGER NOT NULL,
    operation_type TEXT NOT NULL,
    selected_image_id TEXT,
    status TEXT NOT NULL,
    deleted_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id)
  );
  CREATE TABLE IF NOT EXISTS images (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    version_id TEXT,
    task_id TEXT,
    source_type TEXT NOT NULL,
    file_path TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    file_size INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id)
  );
  CREATE TABLE IF NOT EXISTS version_inputs (
    version_id TEXT NOT NULL,
    image_id TEXT NOT NULL,
    input_role TEXT NOT NULL,
    PRIMARY KEY(version_id, image_id)
  );
  CREATE TABLE IF NOT EXISTS gallery_entries (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'mine',
    prompt TEXT NOT NULL DEFAULT '',
    style_prompt TEXT NOT NULL DEFAULT '',
    image_path TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at DESC) WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_messages_project_created ON messages(project_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_versions_project_created ON image_versions(project_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_images_project_version ON images(project_id, version_id);
  PRAGMA optimize;
`);

export const now = () => new Date().toISOString();
export const uid = () => crypto.randomUUID();
export const parseJson = (value, fallback = {}) => {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
};

export function imageDto(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    versionId: row.version_id,
    taskId: row.task_id,
    sourceType: row.source_type,
    url: `/files/${row.project_id}/${row.file_path.replaceAll('\\', '/')}`,
    mimeType: row.mime_type,
    width: row.width,
    height: row.height,
    fileSize: row.file_size,
    createdAt: row.created_at,
  };
}

export function projectDto(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    coverImageId: row.cover_image_id,
    coverUrl: row.cover_file_path ? `/files/${row.id}/${row.cover_file_path.replaceAll('\\', '/')}` : null,
    coverWidth: row.cover_width ?? null,
    coverHeight: row.cover_height ?? null,
    defaultModelId: row.default_model_id,
    currentVersionId: row.current_version_id,
    currentImageId: row.current_image_id,
    draft: parseJson(row.draft_json),
    isFavorite: Boolean(row.is_favorite),
    versionCount: Number(row.version_count ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function ensureProjectDirs(projectId) {
  for (const folder of ['uploads', 'generated', 'thumbnails', 'temp', 'extracts']) {
    mkdirSync(path.join(PROJECTS_ROOT, projectId, folder), { recursive: true });
  }
}

export function closeDatabase() {
  db.close();
}
