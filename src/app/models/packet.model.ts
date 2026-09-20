import { SerializableCell } from './cell.model';
import { SerializableProject } from './project.model';

/**
 * Base packet interface with common fields
 */
export interface BasePacket {
  type: 'ProjectSync' | 'CellUpdate' | 'CellMove' | 'CellCreate' | 'CellDelete';
  timestamp: string;
}

/**
 * ProjectSync packet - syncs the entire project
 */
export interface ProjectSyncPacket extends BasePacket {
  type: 'ProjectSync';
  project: SerializableProject;
}

/**
 * CellUpdate packet - updates a cell with a specific id
 */
export interface CellUpdatePacket extends BasePacket {
  type: 'CellUpdate';
  cellId: string;
  cell: SerializableCell;
}

/**
 * CellMove packet - moves a cell from one index to another
 */
export interface CellMovePacket extends BasePacket {
  type: 'CellMove';
  cellId: string;
  fromIndex: number;
  toIndex: number;
}

/**
 * CellCreate packet - creates a new cell at a specific position
 */
export interface CellCreatePacket extends BasePacket {
  type: 'CellCreate';
  cell: SerializableCell;
  parentCellId?: string; // Optional: if creating inside a folder
  index: number; // Position to insert the cell
}

/**
 * CellDelete packet - deletes a cell by ID
 */
export interface CellDeletePacket extends BasePacket {
  type: 'CellDelete';
  cellId: string;
  parentCellId?: string; // Optional: if deleting from inside a folder
}

/**
 * Union type representing any packet type
 */
export type Packet = ProjectSyncPacket | CellUpdatePacket | CellMovePacket | CellCreatePacket | CellDeletePacket;

/**
 * Connection configuration for websocket
 */
export interface WebSocketConfig {
  name: string;
  projectId: string;
  userId: string;
  url?: string; // Optional, defaults to ws://localhost:8080
}

/**
 * Utility functions for packet creation
 */
export class PacketFactory {
  /**
   * Create a ProjectSync packet
   */
  static createProjectSync(project: SerializableProject): ProjectSyncPacket {
    return {
      type: 'ProjectSync',
      timestamp: new Date().toISOString(),
      project
    };
  }

  /**
   * Create a CellUpdate packet
   */
  static createCellUpdate(cellId: string, cell: SerializableCell): CellUpdatePacket {
    return {
      type: 'CellUpdate',
      timestamp: new Date().toISOString(),
      cellId,
      cell
    };
  }

  /**
   * Create a CellMove packet
   */
  static createCellMove(cellId: string, fromIndex: number, toIndex: number): CellMovePacket {
    return {
      type: 'CellMove',
      timestamp: new Date().toISOString(),
      cellId,
      fromIndex,
      toIndex
    };
  }

  /**
   * Create a CellCreate packet
   */
  static createCellCreate(cell: SerializableCell, index: number, parentCellId?: string): CellCreatePacket {
    return {
      type: 'CellCreate',
      timestamp: new Date().toISOString(),
      cell,
      index,
      parentCellId
    };
  }

  /**
   * Create a CellDelete packet
   */
  static createCellDelete(cellId: string, parentCellId?: string): CellDeletePacket {
    return {
      type: 'CellDelete',
      timestamp: new Date().toISOString(),
      cellId,
      parentCellId
    };
  }

  /**
   * Serialize a packet to JSON string
   */
  static serialize(packet: Packet): string {
    return JSON.stringify(packet);
  }

  /**
   * Deserialize a JSON string to a packet
   */
  static deserialize(json: string): Packet {
    return JSON.parse(json) as Packet;
  }
}

