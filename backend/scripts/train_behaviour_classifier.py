"""
Train a GradientBoostingClassifier on synthetic behaviour data.

Usage (from backend/):
    python -m scripts.generate_training_data          # only needed once
    python -m scripts.train_behaviour_classifier

Outputs:
    core/ml_models/behaviour_classifier.pkl
    core/ml_models/feature_scaler.pkl
"""

import os
import sys

# Allow running from backend/ directory
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import numpy as np

try:
    from sklearn.ensemble import GradientBoostingClassifier
    from sklearn.preprocessing import StandardScaler
    from sklearn.model_selection import StratifiedKFold, cross_val_score
    from sklearn.metrics import classification_report, accuracy_score
    import joblib
except ImportError:
    print("ERROR: scikit-learn not installed.")
    print("  pip install scikit-learn joblib")
    sys.exit(1)

DATA_PATH   = os.path.join(os.path.dirname(__file__), '..', 'data', 'behaviour_training_data.npz')
MODEL_DIR   = os.path.join(os.path.dirname(__file__), '..', 'core', 'ml_models')
MODEL_PATH  = os.path.join(MODEL_DIR, 'behaviour_classifier.pkl')
SCALER_PATH = os.path.join(MODEL_DIR, 'feature_scaler.pkl')

CLASS_LABELS = ['Normal', 'Warning', 'Suspicious']


def main():
    if not os.path.exists(DATA_PATH):
        print(f"Training data not found: {DATA_PATH}")
        print("Run first:  python -m scripts.generate_training_data")
        sys.exit(1)

    data = np.load(DATA_PATH)
    X, y = data['X'], data['y']
    print(f"Dataset  : {len(y):,} samples  |  {X.shape[1]} features")
    print(f"  Normal     : {(y == 0).sum():,}")
    print(f"  Warning    : {(y == 1).sum():,}")
    print(f"  Suspicious : {(y == 2).sum():,}\n")

    # ── Scale ─────────────────────────────────────────────────────────────────
    scaler   = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    # ── 5-fold cross-validation ───────────────────────────────────────────────
    clf = GradientBoostingClassifier(
        n_estimators=300,
        max_depth=5,
        learning_rate=0.05,
        subsample=0.8,
        min_samples_leaf=20,
        random_state=42,
    )

    print("Running 5-fold stratified cross-validation...")
    cv     = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    scores = cross_val_score(clf, X_scaled, y, cv=cv, scoring='accuracy', n_jobs=-1)
    print(f"  Fold accuracies : {[f'{s:.4f}' for s in scores]}")
    print(f"  Mean ± std      : {scores.mean():.4f} ± {scores.std():.4f}")

    if scores.mean() < 0.90:
        print("\n[WARNING] Mean CV accuracy below 90% target.")
        print("  Consider widening the warning/suspicious thresholds in generate_training_data.py")
    else:
        print(f"\n[PASS] CV accuracy {scores.mean() * 100:.1f}% meets the ≥ 90% target.")

    # ── Final fit on full dataset ─────────────────────────────────────────────
    print("\nFitting final model on full dataset...")
    clf.fit(X_scaled, y)

    train_acc = accuracy_score(y, clf.predict(X_scaled))
    print(f"Training accuracy : {train_acc * 100:.2f}%")
    print("\nClassification report (full training set):")
    print(classification_report(y, clf.predict(X_scaled), target_names=CLASS_LABELS))

    # ── Save ──────────────────────────────────────────────────────────────────
    os.makedirs(MODEL_DIR, exist_ok=True)
    joblib.dump(clf,    MODEL_PATH)
    joblib.dump(scaler, SCALER_PATH)
    print(f"Model  saved → {MODEL_PATH}")
    print(f"Scaler saved → {SCALER_PATH}")
    print("\nDone.  Restart the Django server to load the new model.")


if __name__ == '__main__':
    main()
