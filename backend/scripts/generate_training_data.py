"""
Generate synthetic training data for the behaviour classifier.

Produces 10,000 samples per class (30,000 total) with realistic covariance
between features.  The resulting .npz file is used by train_behaviour_classifier.py.

Usage:
    cd backend
    python -m scripts.generate_training_data
"""

import os
import numpy as np

SAMPLES_PER_CLASS = 10_000
SEED = 42


def _normal_samples(n, rng):
    """Simulate a student looking straight at their desk / screen."""
    rel_yaw   = rng.normal(0, 5, n)         # ±5° around baseline
    rel_pitch = rng.normal(0, 4, n)
    rel_roll  = rng.normal(0, 3, n)
    gaze_x    = rng.normal(0, 0.12, n)      # mostly center
    gaze_y    = rng.normal(0.05, 0.10, n)   # very slight downward reading bias
    ear_avg   = rng.normal(0.31, 0.03, n)   # open eyes, normal blinks
    vel_yaw   = rng.normal(0, 1.5, n)
    vel_pitch = rng.normal(0, 1.2, n)
    face_area = rng.normal(0.18, 0.04, n)
    yaw_delta = rng.normal(0, 2.0, n)

    return np.column_stack([
        np.clip(rel_yaw,   -20,  20),
        np.clip(rel_pitch, -18,  18),
        rel_roll,
        np.clip(gaze_x, -1, 1),
        np.clip(gaze_y, -1, 1),
        np.clip(ear_avg, 0.15, 0.50),
        vel_yaw,
        vel_pitch,
        np.clip(face_area, 0.05, 0.50),
        yaw_delta,
    ])


def _warning_samples(n, rng):
    """Simulate attention-wandering / borderline suspicious behaviour."""
    yaw_sign  = rng.choice([-1, 1], n)
    rel_yaw   = yaw_sign * rng.uniform(18, 34, n)
    rel_pitch = rng.uniform(-27, 5, n)       # leaning/looking down
    rel_roll  = rng.normal(0, 5, n)
    gaze_x    = rng.uniform(-0.65, 0.65, n)
    gaze_y    = rng.normal(0.15, 0.15, n)
    ear_avg   = rng.normal(0.27, 0.04, n)
    vel_yaw   = rng.normal(0, 4.5, n)
    vel_pitch = rng.normal(0, 3.5, n)
    face_area = rng.normal(0.15, 0.05, n)
    yaw_delta = rng.normal(0, 6, n)

    return np.column_stack([
        np.clip(rel_yaw,   -35, 35),
        np.clip(rel_pitch, -28, 18),
        rel_roll,
        np.clip(gaze_x, -1, 1),
        np.clip(gaze_y, -1, 1),
        np.clip(ear_avg, 0.15, 0.50),
        vel_yaw,
        vel_pitch,
        np.clip(face_area, 0.05, 0.50),
        yaw_delta,
    ])


def _suspicious_samples(n, rng):
    """Simulate clear cheating behaviour: large head turns, off-axis gaze."""
    yaw_sign  = rng.choice([-1, 1], n)
    rel_yaw   = yaw_sign * rng.uniform(32, 90, n)
    pitch_dir = rng.choice([-1, 1], n)
    rel_pitch = pitch_dir * rng.uniform(22, 70, n)
    rel_roll  = rng.normal(0, 10, n)
    # Gaze tends to follow the head direction
    gaze_x    = np.sign(rel_yaw) * rng.uniform(0.45, 1.0, n)
    gaze_y    = rng.uniform(-0.8, 0.8, n)
    ear_avg   = rng.normal(0.23, 0.05, n)   # slightly squinting
    vel_yaw   = rng.normal(0, 9, n)
    vel_pitch = rng.normal(0, 7, n)
    face_area = rng.normal(0.11, 0.06, n)   # face partly off-frame
    yaw_delta = rng.normal(0, 12, n)

    return np.column_stack([
        rel_yaw,
        rel_pitch,
        rel_roll,
        np.clip(gaze_x, -1, 1),
        np.clip(gaze_y, -1, 1),
        np.clip(ear_avg, 0.10, 0.50),
        vel_yaw,
        vel_pitch,
        np.clip(face_area, 0.02, 0.50),
        yaw_delta,
    ])


def main():
    rng = np.random.default_rng(SEED)

    X_normal     = _normal_samples(SAMPLES_PER_CLASS, rng)
    X_warning    = _warning_samples(SAMPLES_PER_CLASS, rng)
    X_suspicious = _suspicious_samples(SAMPLES_PER_CLASS, rng)

    X = np.vstack([X_normal, X_warning, X_suspicious]).astype(np.float32)
    y = np.array(
        [0] * SAMPLES_PER_CLASS +
        [1] * SAMPLES_PER_CLASS +
        [2] * SAMPLES_PER_CLASS,
        dtype=np.int32,
    )

    idx  = rng.permutation(len(y))
    X, y = X[idx], y[idx]

    out_dir  = os.path.join(os.path.dirname(__file__), '..', 'data')
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, 'behaviour_training_data.npz')
    np.savez(out_path, X=X, y=y)

    print(f"Saved {len(y):,} samples  →  {out_path}")
    print(f"  Normal     : {(y == 0).sum():,}")
    print(f"  Warning    : {(y == 1).sum():,}")
    print(f"  Suspicious : {(y == 2).sum():,}")
    print(f"  Features   : {X.shape[1]}")


if __name__ == '__main__':
    main()
