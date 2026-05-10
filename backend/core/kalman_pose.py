"""
Constant-velocity Kalman filter for head pose smoothing.

State vector: [pitch, yaw, roll, d_pitch, d_yaw, d_roll]  (6D)
Measurement:  [pitch, yaw, roll]                           (3D)

A Mahalanobis distance gate rejects solvePnP outlier frames
instead of blending them in with the state.
"""

import numpy as np
import time


class PoseKalmanFilter:

    def __init__(self):
        self.n = 6  # state dim
        self.m = 3  # measurement dim

        # Measurement matrix: observe position only
        self.H = np.zeros((self.m, self.n))
        self.H[:, :self.m] = np.eye(self.m)

        # Process noise — tune velocity uncertainty higher so the filter
        # can track fast head turns without lag.
        q_pos = 1.0    # deg²
        q_vel = 12.0   # deg²/frame²
        self.Q = np.diag([q_pos, q_pos, q_pos, q_vel, q_vel, q_vel])

        # Measurement noise (solvePnP pixel-reprojection → ~2° error)
        self.R = np.eye(self.m) * 4.0

        # State and covariance
        self.x = np.zeros(self.n)
        self.P = np.eye(self.n) * 100.0

        self.initialized = False
        self._last_ts    = None

        # Chi-squared gate: df=3, 99th percentile ≈ 11.34
        self.gate_threshold = 11.34

    # ─────────────────────────────────────────────────────────────────────────

    def reset(self):
        self.x[:]        = 0.0
        self.P[:]        = np.eye(self.n) * 100.0
        self.initialized = False
        self._last_ts    = None

    # ─────────────────────────────────────────────────────────────────────────

    def update(self, pitch: float, yaw: float, roll: float,
               ts: float = None) -> tuple:
        """
        Incorporate a measurement and return filtered (pitch, yaw, roll).
        Each returned angle is clamped to [-90, 90].
        """
        if ts is None:
            ts = time.time()

        z = np.array([pitch, yaw, roll], dtype=float)

        if not self.initialized:
            self.x[:self.m] = z
            self.x[self.m:] = 0.0
            self._last_ts   = ts
            self.initialized = True
            return pitch, yaw, roll

        dt = max(1e-3, ts - self._last_ts)
        self._last_ts = ts

        # ── Predict ──────────────────────────────────────────────────────────
        F = np.eye(self.n)
        F[0, 3] = dt
        F[1, 4] = dt
        F[2, 5] = dt

        x_pred = F @ self.x
        P_pred = F @ self.P @ F.T + self.Q

        # ── Innovation and Mahalanobis gate ──────────────────────────────────
        y_innov = z - self.H @ x_pred
        S       = self.H @ P_pred @ self.H.T + self.R
        try:
            S_inv = np.linalg.inv(S)
        except np.linalg.LinAlgError:
            S_inv = np.linalg.pinv(S)

        mahal_sq = float(y_innov @ S_inv @ y_innov)

        if mahal_sq > self.gate_threshold:
            # Outlier — propagate prediction only
            self.x = x_pred
            self.P = P_pred
        else:
            # ── Update ────────────────────────────────────────────────────────
            K      = P_pred @ self.H.T @ S_inv
            self.x = x_pred + K @ y_innov
            self.P = (np.eye(self.n) - K @ self.H) @ P_pred

        return (
            float(np.clip(self.x[0], -90.0, 90.0)),
            float(np.clip(self.x[1], -90.0, 90.0)),
            float(np.clip(self.x[2], -90.0, 90.0)),
        )

    @property
    def velocity(self) -> tuple:
        """Return (d_pitch, d_yaw, d_roll) angular velocity from state."""
        return float(self.x[3]), float(self.x[4]), float(self.x[5])
