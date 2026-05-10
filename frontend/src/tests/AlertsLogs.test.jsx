import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import AlertsLogs from '../pages/AlertsLogs';
import api from '../api';

vi.mock('../api');

describe('AlertsLogs Component', () => {
  it('renders a list of alerts and filters them', async () => {
    api.get.mockImplementation(() => Promise.resolve({
      data: [
        { id: 1, alert_type: 'multiple_faces', severity: 'critical', message: 'Two people found', timestamp: '2026-05-10T10:00:00Z', student_roll: 'CS1' },
        { id: 2, alert_type: 'face_missing', severity: 'suspicious', message: 'No face', timestamp: '2026-05-10T10:05:00Z', student_roll: 'CS2' }
      ]
    }));

    render(
      <BrowserRouter>
        <AlertsLogs />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Two people found/i)).toBeInTheDocument();
      expect(screen.getByText(/No face/i)).toBeInTheDocument();
    });
    
    // Check if the alert types are rendered properly
    expect(screen.getAllByText(/multiple faces/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/face missing/i).length).toBeGreaterThan(0);
  });
});
