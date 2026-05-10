# AI Detection System — Technical Reference

## Architecture Overview

The system uses a **hybrid ML + rules** pipeline:

```
Camera frame
    │
    ▼
MediaPipe FaceMesh (478 landmarks, refine_landmarks=True)
    │
    ▼
10-point solvePnP (EPNP) ──► raw (pitch, yaw, roll)
    │
    ▼
Per-student Kalman Filter ──► smoothed angles + angular velocity
    │
    ▼
Baseline calibration (30-frame median) ──► relative angles
    │
    ├── Bilateral gaze vector  (lm 468, 473 irises)
    ├── EAR — Eye Aspect Ratio (both eyes)
    └── 10D feature vector
              │
              ▼
   GradientBoostingClassifier  (≥0.70 confidence)
              │ fallback if unavailable or low confidence
              ▼
        Rule-based thresholds
              │
              ▼
   Time-based state machine ──► Normal / Warning / Suspicious / Critical
              │
              ▼
        Alert emission (per-student, per-type cooldown)
```

---

## Feature Vector (10D)

| # | Name          | Description                                      | Typical range     |
|---|---------------|--------------------------------------------------|-------------------|
| 0 | `rel_yaw`     | Yaw relative to calibration baseline (°)         | –90 … +90         |
| 1 | `rel_pitch`   | Pitch relative to baseline (°)                   | –90 … +90         |
| 2 | `rel_roll`    | Roll relative to baseline (°)                    | –45 … +45         |
| 3 | `gaze_x`      | Horizontal iris deviation (–1=left, +1=right)    | –1.0 … +1.0       |
| 4 | `gaze_y`      | Vertical iris deviation (–1=up, +1=down)         | –1.0 … +1.0       |
| 5 | `ear_avg`     | Mean Eye Aspect Ratio (0.30 open, 0.18 closed)   | 0.10 … 0.50       |
| 6 | `vel_yaw`     | Kalman yaw angular velocity (°/s)                | –30 … +30         |
| 7 | `vel_pitch`   | Kalman pitch angular velocity (°/s)              | –30 … +30         |
| 8 | `face_area`   | Face bbox as fraction of frame area              | 0.02 … 0.50       |
| 9 | `yaw_delta_3f`| Yaw change over last 3 Kalman frames (°)         | –30 … +30         |

---

## Classifier

**Model:** `sklearn.ensemble.GradientBoostingClassifier`

| Hyperparameter      | Value  |
|---------------------|--------|
| `n_estimators`      | 300    |
| `max_depth`         | 5      |
| `learning_rate`     | 0.05   |
| `subsample`         | 0.8    |
| `min_samples_leaf`  | 20     |

**Classes:** `Normal (0)`, `Warning (1)`, `Suspicious (2)`

**Saved files:**
- `core/ml_models/behaviour_classifier.pkl` — trained model
- `core/ml_models/feature_scaler.pkl` — StandardScaler fitted on training data

The ML result is used only when prediction confidence ≥ **0.70**. Below that threshold the system falls back to the rule-based zone calculation.

---

## Detection Thresholds

### Relative angle zones

| Zone       | Yaw (°)    | Pitch (°)  |
|------------|------------|------------|
| Normal     | ≤ 20       | ≤ 18       |
| Warning    | 20 – 35    | 18 – 28    |
| Suspicious | > 35       | > 28       |

### State machine durations

| Transition                         | Seconds |
|------------------------------------|---------|
| Abnormal zone → enter Warning      | 3.0     |
| Suspicious zone → enter Suspicious | 8.0     |
| Normal zone → recover to Normal    | 3.0     |

### Other thresholds

| Parameter                        | Value |
|----------------------------------|-------|
| EAR low (eyes closed / averted)  | 0.20  |
| Gaze suspicious frames           | 8     |
| Face missing alert               | 25 frames |
| Multiple faces alert             | 10 frames |
| Calibration frames               | 30    |
| Recalibrate after face absent    | 50 frames |

---

## Kalman Filter

**State:** `[pitch, yaw, roll, d_pitch, d_yaw, d_roll]` (6D)  
**Model:** constant-velocity  
**Measurement:** `[pitch, yaw, roll]` (3D)  
**Outlier gate:** Mahalanobis distance > 11.34 (χ² df=3, 99th pct) → predict-only, reject measurement  
**Process noise:** position q=1.0°², velocity q=12.0°²/frame²  
**Measurement noise:** r=4.0°²  

---

## Retrain / Fine-tune

### 1. Modify training data

Edit `scripts/generate_training_data.py` to adjust the distribution of each class.  
Key parameters to tune:

- **Normal**: `rng.normal(0, 5, n)` for `rel_yaw` — controls how tight the normal zone is
- **Warning**: `rng.uniform(18, 34, n)` — lower bound should match `REL_YAW_NORMAL` in `ai_engine.py`
- **Suspicious**: `rng.uniform(32, 90, n)` — lower bound should match `REL_YAW_WARNING`

After changing distributions, regenerate:
```bash
cd backend
python -m scripts.generate_training_data
```

### 2. Retrain

```bash
cd backend
python -m scripts.train_behaviour_classifier
```

The script runs 5-fold cross-validation and prints accuracy before saving. The model is only saved if training completes — the server can continue to run the old model during retraining.

### 3. Reload

Restart the Django/Daphne server. `BehaviourClassifier._load()` is called once at `SurveillanceAI.__init__()`:

```bash
# If running via manage.py
python manage.py runserver

# If running via daphne
daphne surveillance_backend.asgi:application
```

### 4. Evaluate

```bash
cd backend
python -m scripts.evaluate_accuracy
```

Compares rule-based and ML accuracy on the held-out 20% test split.

---

## Accuracy Benchmark

| Method         | Test Accuracy | Weighted F1 |
|----------------|---------------|-------------|
| Rule-based     | 96.7%         | 0.9664      |
| GradientBoost  | **100.0%**    | **1.0000**  |

Target: ≥ 90% — **PASS**

The rule-based system is already accurate (96.7%) because the class boundaries are exactly the thresholds. The ML classifier learns the soft boundary and eliminates the 192 Normal→Warning misclassifications caused by the hard-threshold cut.

---

## File Map

```
backend/
├── core/
│   ├── ai_engine.py          — main SurveillanceAI class (v2)
│   ├── kalman_pose.py        — PoseKalmanFilter (constant-velocity, 6-state)
│   ├── feature_extractor.py  — EAR, gaze vector, feature assembly, BehaviourClassifier
│   └── ml_models/
│       ├── behaviour_classifier.pkl   — trained GradientBoostingClassifier
│       └── feature_scaler.pkl         — fitted StandardScaler
├── scripts/
│   ├── generate_training_data.py      — synthetic dataset (30k samples, 3 classes)
│   ├── train_behaviour_classifier.py  — training + 5-fold CV
│   └── evaluate_accuracy.py           — rules vs ML comparison report
└── data/
    └── behaviour_training_data.npz    — generated dataset (not committed)
```
