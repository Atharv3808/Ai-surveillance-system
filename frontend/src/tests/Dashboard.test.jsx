import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import Dashboard from '../pages/Dashboard';
import api from '../api';

vi.mock('../api');

describe('Dashboard Component', () => {
  it('renders dashboard stats correctly after API call', async () => {
    api.get.mockImplementation((url) => {
      if (url === 'dashboard-stats/') {
        return Promise.resolve({ data: { totalStudents: 150, activeSessions: 2, alertsToday: 5, avgConfidence: 0.92 } });
      }
      return Promise.resolve({ data: [] });
    });

    render(
      <BrowserRouter>
        <Dashboard />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('150')).toBeInTheDocument(); // Enrolled Students
      expect(screen.getByText('2')).toBeInTheDocument();   // Active Sessions
      expect(screen.getByText('5')).toBeInTheDocument();   // Alerts Generated
      expect(screen.getByText('92.0%')).toBeInTheDocument(); // AI Accuracy
    });
  });

  it('displays recent alerts correctly', async () => {
    api.get.mockImplementation((url) => {
      if (url === 'dashboard-stats/') return Promise.resolve({ data: {} });
      if (url.includes('alerts')) {
        return Promise.resolve({
          data: [
            { id: 1, alert_type: 'suspicious_head_movement', severity: 'warning', message: 'Looking left', timestamp: new Date().toISOString() }
          ]
        });
      }
      return Promise.resolve({ data: [] });
    });

    render(
      <BrowserRouter>
        <Dashboard />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('suspicious head movement')).toBeInTheDocument();
      expect(screen.getByText('Looking left')).toBeInTheDocument();
    });
  });
});
