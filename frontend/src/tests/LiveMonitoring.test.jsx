import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import LiveMonitoring from '../pages/LiveMonitoring';
import api from '../api';

vi.mock('../api');

describe('LiveMonitoring Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock WebSocket
    global.WebSocket = vi.fn(() => ({
      send: vi.fn(),
      close: vi.fn(),
      addEventListener: vi.fn(),
      readyState: 1 // OPEN
    }));
  });

  it('fetches active session and connects to websocket', async () => {
    api.get.mockResolvedValueOnce({
      data: [{ id: 1, is_active: true, title: 'Test Session' }]
    });

    render(
      <BrowserRouter>
        <LiveMonitoring />
      </BrowserRouter>
    );

    // Wait for API resolution
    await waitFor(() => {
      expect(global.WebSocket).toHaveBeenCalledWith(expect.stringContaining('/ws/monitoring/1/'));
    });
    
    // Check UI elements
    expect(screen.getByText('System Offline')).toBeInTheDocument(); // Before WS open event fires
  });

  it('renders start camera button when inactive', async () => {
    api.get.mockResolvedValueOnce({
      data: [{ id: 1, is_active: true }]
    });

    render(
      <BrowserRouter>
        <LiveMonitoring />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Initialize Visual Stream')).toBeInTheDocument();
    });
  });
});
