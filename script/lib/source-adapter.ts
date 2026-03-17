import fs from "node:fs";
import path from "node:path";

export type SourceListItem = {
  relativePath: string;
  absolutePath: string;
  isDirectory: boolean;
};

export interface SourceAdapter {
  listItems(prefix?: string): Promise<SourceListItem[]>;
  readFile(relativePath: string): Promise<Buffer>;
  moveItem?(fromRelativePath: string, toRelativePath: string): Promise<void>;
  writeManifest?(relativePath: string, body: unknown): Promise<void>;
}

export class LocalFolderSourceAdapter implements SourceAdapter {
  constructor(private readonly rootDir: string) {}

  private async resolveSafePath(relativePath: string): Promise<string> {
    const rootRealPath = await fs.promises.realpath(this.rootDir);
    const candidate = path.resolve(this.rootDir, relativePath);
    const rel = path.relative(rootRealPath, candidate);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(`Path escapes source root: ${relativePath}`);
    }

    const parentDir = path.dirname(candidate);
    if (fs.existsSync(parentDir)) {
      const parentStat = await fs.promises.lstat(parentDir);
      if (parentStat.isSymbolicLink()) {
        throw new Error(`Symlink parent blocked: ${relativePath}`);
      }
    }

    return candidate;
  }

  async listItems(prefix = ""): Promise<SourceListItem[]> {
    const startDir = path.join(this.rootDir, prefix);
    const rootRealPath = await fs.promises.realpath(this.rootDir);
    if (!fs.existsSync(startDir)) {
      return [];
    }

    const out: SourceListItem[] = [];
    const walk = async (dir: string): Promise<void> => {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const absolutePath = path.join(dir, entry.name);
        const stat = await fs.promises.lstat(absolutePath);
        if (stat.isSymbolicLink()) {
          continue;
        }
        const normalizedAbsolutePath = path.resolve(absolutePath);
        const relToRoot = path.relative(rootRealPath, normalizedAbsolutePath);
        if (relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) {
          continue;
        }
        const relativePath = path.relative(this.rootDir, absolutePath).split(path.sep).join("/");
        out.push({ relativePath, absolutePath, isDirectory: entry.isDirectory() });
        if (entry.isDirectory()) {
          await walk(absolutePath);
        }
      }
    };

    await walk(startDir);
    return out;
  }

  async readFile(relativePath: string): Promise<Buffer> {
    const target = await this.resolveSafePath(relativePath);
    const stat = await fs.promises.lstat(target);
    if (stat.isSymbolicLink()) {
      throw new Error(`Symlink source blocked: ${relativePath}`);
    }
    return fs.promises.readFile(target);
  }

  async moveItem(fromRelativePath: string, toRelativePath: string): Promise<void> {
    const from = await this.resolveSafePath(fromRelativePath);
    const to = await this.resolveSafePath(toRelativePath);
    const fromStat = await fs.promises.lstat(from);
    if (fromStat.isSymbolicLink()) {
      throw new Error(`Symlink source blocked: ${fromRelativePath}`);
    }
    await fs.promises.mkdir(path.dirname(to), { recursive: true });
    await fs.promises.rename(from, to);
  }

  async writeManifest(relativePath: string, body: unknown): Promise<void> {
    const targetPath = await this.resolveSafePath(relativePath);
    if (fs.existsSync(targetPath)) {
      const stat = await fs.promises.lstat(targetPath);
      if (stat.isSymbolicLink()) {
        throw new Error(`Symlink manifest target blocked: ${relativePath}`);
      }
    }
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.promises.writeFile(targetPath, JSON.stringify(body, null, 2), "utf8");
  }
}
