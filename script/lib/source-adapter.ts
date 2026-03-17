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

  async listItems(prefix = ""): Promise<SourceListItem[]> {
    const startDir = path.join(this.rootDir, prefix);
    if (!fs.existsSync(startDir)) {
      return [];
    }

    const out: SourceListItem[] = [];
    const walk = async (dir: string): Promise<void> => {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const absolutePath = path.join(dir, entry.name);
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
    return fs.promises.readFile(path.join(this.rootDir, relativePath));
  }

  async moveItem(fromRelativePath: string, toRelativePath: string): Promise<void> {
    const from = path.join(this.rootDir, fromRelativePath);
    const to = path.join(this.rootDir, toRelativePath);
    await fs.promises.mkdir(path.dirname(to), { recursive: true });
    await fs.promises.rename(from, to);
  }

  async writeManifest(relativePath: string, body: unknown): Promise<void> {
    const targetPath = path.join(this.rootDir, relativePath);
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.promises.writeFile(targetPath, JSON.stringify(body, null, 2), "utf8");
  }
}
