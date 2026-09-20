import { Injectable, OnDestroy } from '@angular/core';
import { Subject, Subscription } from 'rxjs';
import { PacketManagerService } from './packet-manager.service';
import {
  Packet,
  ProjectSyncPacket,
  CellUpdatePacket,
  CellMovePacket,
  CellCreatePacket,
  CellDeletePacket
} from '../models/packet.model';
import { Project, Cell, CellSerializer } from '../models';
import { PythonExecutorService } from './python-executor.service';

/**
 * Event emitted when the project is synced
 */
export interface ProjectSyncEvent {
  project: Project;
}

/**
 * Event emitted when a cell is updated
 */
export interface CellUpdateEvent {
  cellId: string;
  cell: Cell;
}

/**
 * Event emitted when a cell is moved
 */
export interface CellMoveEvent {
  cellId: string;
  fromIndex: number;
  toIndex: number;
}

/**
 * Event emitted when a cell is created
 */
export interface CellCreateEvent {
  cell: Cell;
  index: number;
  parentCellId?: string;
}

/**
 * Event emitted when a cell is deleted
 */
export interface CellDeleteEvent {
  cellId: string;
  parentCellId?: string;
}

/**
 * Service for handling incoming packets and applying changes to the project
 */
@Injectable({
  providedIn: 'root'
})
export class PacketHandlerService implements OnDestroy {
  private currentProject: Project | null = null;
  private packetSubscription: Subscription | null = null;

  // Observables for packet events
  private projectSyncSubject = new Subject<ProjectSyncEvent>();
  public projectSync$ = this.projectSyncSubject.asObservable();

  private cellUpdateSubject = new Subject<CellUpdateEvent>();
  public cellUpdate$ = this.cellUpdateSubject.asObservable();

  private cellMoveSubject = new Subject<CellMoveEvent>();
  public cellMove$ = this.cellMoveSubject.asObservable();

  private cellCreateSubject = new Subject<CellCreateEvent>();
  public cellCreate$ = this.cellCreateSubject.asObservable();

  private cellDeleteSubject = new Subject<CellDeleteEvent>();
  public cellDelete$ = this.cellDeleteSubject.asObservable();

  private errorSubject = new Subject<string>();
  public errors$ = this.errorSubject.asObservable();

  constructor(
    private packetManager: PacketManagerService,
    private pythonExecutor: PythonExecutorService
  ) {
    // Subscribe to incoming packets
    this.packetSubscription = this.packetManager.incomingPackets$.subscribe(
      (packet) => this.handlePacket(packet)
    );
  }

  /**
   * Set the current project that will be modified by incoming packets
   */
  setProject(project: Project): void {
    this.currentProject = project;
  }

  /**
   * Get the current project
   */
  getProject(): Project | null {
    return this.currentProject;
  }

  /**
   * Handle incoming packet based on its type
   */
  private handlePacket(packet: Packet): void {
    try {
      switch (packet.type) {
        case 'ProjectSync':
          this.handleProjectSync(packet as ProjectSyncPacket);
          break;
        case 'CellUpdate':
          this.handleCellUpdate(packet as CellUpdatePacket);
          break;
        case 'CellMove':
          this.handleCellMove(packet as CellMovePacket);
          break;
        case 'CellCreate':
          this.handleCellCreate(packet as CellCreatePacket);
          break;
        case 'CellDelete':
          this.handleCellDelete(packet as CellDeletePacket);
          break;
        default:
          console.warn('[PacketHandler] Unknown packet type:', (packet as any).type);
      }
    } catch (error) {
      console.error('[PacketHandler] Error handling packet:', error);
      this.errorSubject.next(`Error handling packet: ${error}`);
    }
  }

  /**
   * Handle ProjectSync packet - replaces the entire project
   */
  private handleProjectSync(packet: ProjectSyncPacket): void {
    try {
      const project = Project.fromJSON(packet.project);
      this.currentProject = project;

      this.projectSyncSubject.next({ project });
    } catch (error) {
      console.error('[PacketHandler] Failed to sync project:', error);
      this.errorSubject.next(`Failed to sync project: ${error}`);
    }
  }

  /**
   * Handle CellUpdate packet - updates a specific cell
   */
  private handleCellUpdate(packet: CellUpdatePacket): void {
    if (!this.currentProject) {
      console.warn('[PacketHandler] No project set, cannot update cell');
      this.errorSubject.next('No project set, cannot update cell');
      return;
    }

    try {
      // Find the cell and its parent array so we can replace it
      const result = this.findCellWithParentArray(this.currentProject.cells, packet.cellId);

      if (!result) {
        console.warn('[PacketHandler] Cell not found:', packet.cellId);
        this.errorSubject.next(`Cell not found: ${packet.cellId}`);
        return;
      }

      const { cell: existingCell, parentArray, currentIndex } = result;

      // Deserialize the updated cell
      const updatedCell = CellSerializer.deserialize(packet.cell);

      // Replace the cell in the parent array with the updated one
      // This creates a new cell reference which Angular will detect
      parentArray[currentIndex] = updatedCell;

      // Update project timestamp
      this.currentProject.updatedAt = new Date();

      this.cellUpdateSubject.next({
        cellId: packet.cellId,
        cell: updatedCell
      });
    } catch (error) {
      console.error('[PacketHandler] Failed to update cell:', error);
      this.errorSubject.next(`Failed to update cell: ${error}`);
    }
  }

  /**
   * Handle CellMove packet - moves a cell from one index to another
   */
  private handleCellMove(packet: CellMovePacket): void {
    if (!this.currentProject) {
      console.warn('[PacketHandler] No project set, cannot move cell');
      this.errorSubject.next('No project set, cannot move cell');
      return;
    }

    try {
      // Find the cell and its parent array
      const result = this.findCellWithParentArray(this.currentProject.cells, packet.cellId);

      if (!result) {
        console.warn('[PacketHandler] Cell not found:', packet.cellId);
        this.errorSubject.next(`Cell not found: ${packet.cellId}`);
        return;
      }

      const { cell, parentArray, currentIndex } = result;

      // Validate indices
      if (packet.fromIndex !== currentIndex) {
        console.warn('[PacketHandler] fromIndex mismatch:', packet.fromIndex, 'vs', currentIndex);
      }

      if (packet.toIndex < 0 || packet.toIndex >= parentArray.length) {
        console.warn('[PacketHandler] Invalid toIndex:', packet.toIndex);
        this.errorSubject.next(`Invalid toIndex: ${packet.toIndex}`);
        return;
      }

      // Remove cell from current position
      parentArray.splice(currentIndex, 1);

      // Insert at new position
      parentArray.splice(packet.toIndex, 0, cell);

      // Update project timestamp
      this.currentProject.updatedAt = new Date();

      // Update context starting from the earlier of the two positions
      const updateFromIndex = Math.min(currentIndex, packet.toIndex);
      if (cell.type === 'equation') {
        this.propagateContextFromIndex(parentArray, updateFromIndex);
      }

      this.cellMoveSubject.next({
        cellId: packet.cellId,
        fromIndex: packet.fromIndex,
        toIndex: packet.toIndex
      });
    } catch (error) {
      console.error('[PacketHandler] Failed to move cell:', error);
      this.errorSubject.next(`Failed to move cell: ${error}`);
    }
  }

  /**
   * Find a cell and return it with its parent array and current index
   */
  private findCellWithParentArray(
    cells: Cell[],
    cellId: string
  ): { cell: Cell; parentArray: Cell[]; currentIndex: number } | null {
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];

      if (cell.id === cellId) {
        return { cell, parentArray: cells, currentIndex: i };
      }

      if (cell.type === 'folder') {
        const found = this.findCellWithParentArray(cell.cells, cellId);
        if (found) {
          return found;
        }
      }
    }

    return null;
  }

  /**
   * Handle CellCreate packet - creates a new cell at a specific position
   */
  private handleCellCreate(packet: CellCreatePacket): void {
    if (!this.currentProject) {
      console.warn('[PacketHandler] No project set, cannot create cell');
      this.errorSubject.next('No project set, cannot create cell');
      return;
    }

    try {
      // Deserialize the new cell
      const newCell = CellSerializer.deserialize(packet.cell);

      // Find the parent array (either root or inside a folder)
      let parentArray: Cell[];

      if (packet.parentCellId) {
        const parentCell = this.currentProject.findCell(packet.parentCellId);
        if (!parentCell || parentCell.type !== 'folder') {
          console.warn('[PacketHandler] Parent folder not found:', packet.parentCellId);
          this.errorSubject.next(`Parent folder not found: ${packet.parentCellId}`);
          return;
        }
        parentArray = parentCell.cells;
      } else {
        parentArray = this.currentProject.cells;
      }

      // Insert the cell at the specified index
      parentArray.splice(packet.index, 0, newCell);

      // Update project timestamp
      this.currentProject.updatedAt = new Date();

      this.cellCreateSubject.next({
        cell: newCell,
        index: packet.index,
        parentCellId: packet.parentCellId
      });
    } catch (error) {
      console.error('[PacketHandler] Failed to create cell:', error);
      this.errorSubject.next(`Failed to create cell: ${error}`);
    }
  }

  /**
   * Handle CellDelete packet - deletes a cell by ID
   */
  private handleCellDelete(packet: CellDeletePacket): void {
    if (!this.currentProject) {
      console.warn('[PacketHandler] No project set, cannot delete cell');
      this.errorSubject.next('No project set, cannot delete cell');
      return;
    }

    try {
      // Find the cell and its parent array
      const result = this.findCellWithParentArray(this.currentProject.cells, packet.cellId);

      if (!result) {
        console.warn('[PacketHandler] Cell not found:', packet.cellId);
        this.errorSubject.next(`Cell not found: ${packet.cellId}`);
        return;
      }

      const { parentArray, currentIndex } = result;

      // Remove the cell from its parent array
      parentArray.splice(currentIndex, 1);

      // Update project timestamp
      this.currentProject.updatedAt = new Date();

      this.cellDeleteSubject.next({
        cellId: packet.cellId,
        parentCellId: packet.parentCellId
      });
    } catch (error) {
      console.error('[PacketHandler] Failed to delete cell:', error);
      this.errorSubject.next(`Failed to delete cell: ${error}`);
    }
  }

  /**
   * Propagate context updates starting from a specific index
   */
  private propagateContextFromIndex(cells: Cell[], startIndex: number): void {
    if (!this.currentProject) {
      return;
    }

    // Find the first equation cell and trigger updateContext
    for (let i = startIndex; i < cells.length; i++) {
      if (cells[i].type === 'equation') {
        this.currentProject.updateContext(cells[i].id, this.pythonExecutor)
          .catch(error => {
            console.error('[PacketHandler] Failed to update context:', error);
          });
        break;
      }
    }
  }

  ngOnDestroy(): void {
    if (this.packetSubscription) {
      this.packetSubscription.unsubscribe();
    }
  }
}

