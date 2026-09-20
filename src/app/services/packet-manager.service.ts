import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { Packet, PacketFactory, WebSocketConfig } from '../models/packet.model';

/**
 * Service for managing WebSocket connections and packet communication
 */
@Injectable({
  providedIn: 'root'
})
export class PacketManagerService {
  private ws: WebSocket | null = null;
  private config: WebSocketConfig | null = null;

  // Observable for connection status
  private connectionStatusSubject = new BehaviorSubject<boolean>(false);
  public connectionStatus$: Observable<boolean> = this.connectionStatusSubject.asObservable();

  // Observable for incoming packets
  private incomingPacketsSubject = new Subject<Packet>();
  public incomingPackets$: Observable<Packet> = this.incomingPacketsSubject.asObservable();

  // Observable for errors
  private errorSubject = new Subject<string>();
  public errors$: Observable<string> = this.errorSubject.asObservable();

  // Reconnection settings
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 2000; // Start with 2 seconds
  private reconnectTimeout: any = null;

  constructor() {}

  /**
   * Connect to WebSocket server with configuration
   */
  connect(config: WebSocketConfig): void {
    this.config = config;

    // Close existing connection if any
    if (this.ws) {
      this.disconnect();
    }

    // Default URL if not provided
    const url = config.url || 'ws://localhost:8080';

    // Build connection URL with query parameters
    const fullUrl = `${url}?name=${encodeURIComponent(config.name)}&projectId=${encodeURIComponent(config.projectId)}&userId=${encodeURIComponent(config.userId)}`;

    try {
      this.ws = new WebSocket(fullUrl);

      this.ws.onopen = () => {
        this.connectionStatusSubject.next(true);
        this.reconnectAttempts = 0; // Reset reconnect attempts on successful connection
      };

      this.ws.onmessage = (event: MessageEvent) => {
        try {
          const packet = PacketFactory.deserialize(event.data);
          this.incomingPacketsSubject.next(packet);
        } catch (error) {
          console.error('[PacketManager] Failed to parse incoming packet:', error);
          this.errorSubject.next(`Failed to parse incoming packet: ${error}`);
        }
      };

      this.ws.onerror = (event: Event) => {
        console.error('[PacketManager] WebSocket error:', event);
        this.errorSubject.next('WebSocket connection error');
      };

      this.ws.onclose = (event: CloseEvent) => {
        this.connectionStatusSubject.next(false);

        // Attempt reconnection if not a normal closure
        if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.scheduleReconnect();
        }
      };
    } catch (error) {
      console.error('[PacketManager] Failed to create WebSocket:', error);
      this.errorSubject.next(`Failed to create WebSocket: ${error}`);
    }
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
      this.connectionStatusSubject.next(false);
    }

    this.reconnectAttempts = 0;
  }

  /**
   * Send a packet to the server
   */
  sendPacket(packet: Packet): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('[PacketManager] Cannot send packet: WebSocket not connected');
      this.errorSubject.next('Cannot send packet: not connected');
      return false;
    }

    try {
      const json = PacketFactory.serialize(packet);
      this.ws.send(json);
      return true;
    } catch (error) {
      console.error('[PacketManager] Failed to send packet:', error);
      this.errorSubject.next(`Failed to send packet: ${error}`);
      return false;
    }
  }

  /**
   * Check if currently connected
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Get current configuration
   */
  getConfig(): WebSocketConfig | null {
    return this.config;
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimeout) {
      return; // Already scheduled
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1); // Exponential backoff

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      if (this.config) {
        this.connect(this.config);
      }
    }, delay);
  }

  /**
   * Clean up on service destruction
   */
  ngOnDestroy(): void {
    this.disconnect();
  }
}

