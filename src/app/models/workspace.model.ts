import { Project, SerializableProject } from './project.model';

export const WORKSPACE_FORMAT = 'alpha-solve/workspace';
export const WORKSPACE_VERSION = 1;

export interface SerializableWorkspace {
  format: typeof WORKSPACE_FORMAT;
  version: number;
  id: string;
  name: string;
  systems: SerializableProject[];
  activeSystemId: string;
  createdAt: string;
  updatedAt: string;
}

export class Workspace {
  id: string;
  name: string;
  systems: Project[];
  activeSystemId: string;
  createdAt: Date;
  updatedAt: Date;

  constructor(
    name: string,
    systems: Project[],
    activeSystemId?: string,
    id?: string,
    createdAt?: Date,
    updatedAt?: Date
  ) {
    this.id = id || crypto.randomUUID();
    this.name = name;
    this.systems = systems;
    this.activeSystemId = activeSystemId || systems[0]?.id || '';
    this.createdAt = createdAt || new Date();
    this.updatedAt = updatedAt || new Date();
  }

  get activeSystem(): Project | null {
    return this.systems.find(system => system.id === this.activeSystemId) || this.systems[0] || null;
  }

  toJSON(): SerializableWorkspace {
    return {
      format: WORKSPACE_FORMAT,
      version: WORKSPACE_VERSION,
      id: this.id,
      name: this.name,
      systems: this.systems.map(system => system.toJSON()),
      activeSystemId: this.activeSystemId,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString()
    };
  }

  toString(): string {
    return JSON.stringify(this.toJSON(), null, 2);
  }

  static fromJSON(data: SerializableWorkspace): Workspace {
    if (data.format !== WORKSPACE_FORMAT) {
      throw new Error(`Unsupported workspace format: ${String(data.format)}`);
    }
    if (data.version > WORKSPACE_VERSION) {
      throw new Error(`Workspace version ${data.version} is newer than this application supports.`);
    }

    return new Workspace(
      data.name,
      data.systems.map(system => Project.fromJSON(system)),
      data.activeSystemId,
      data.id,
      new Date(data.createdAt),
      new Date(data.updatedAt)
    );
  }

  static fromString(json: string): Workspace {
    return Workspace.fromJSON(JSON.parse(json) as SerializableWorkspace);
  }
}

