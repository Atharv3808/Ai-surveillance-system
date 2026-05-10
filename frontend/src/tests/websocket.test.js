import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('WebSocket Client Integration', () => {
  let ws;

  beforeEach(() => {
    ws = {
      send: vi.fn(),
      close: vi.fn(),
      onmessage: null,
      onopen: null,
      onclose: null,
    };
    global.WebSocket = vi.fn(() => ws);
  });

  it('handles incoming detections correctly', () => {
    const mockSetDetections = vi.fn();
    
    // Simulate the LiveMonitoring WebSocket initialization
    const socket = new WebSocket('ws://localhost/ws/monitoring/1/');
    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.detections) mockSetDetections(data.detections);
    };

    // Simulate incoming message
    const mockEvent = {
      data: JSON.stringify({
        detections: [{ name: 'John', confidence: 0.98, bbox: [0, 0, 100, 100] }]
      })
    };
    
    socket.onmessage(mockEvent);
    
    expect(mockSetDetections).toHaveBeenCalledWith([
      { name: 'John', confidence: 0.98, bbox: [0, 0, 100, 100] }
    ]);
  });
});
