"""
Compare rule-based vs ML-based accuracy on the held-out test portion.

Usage (from backend/):
    python -m scripts.evaluate_accuracy

The last 20% of the generated dataset is used as a deterministic test set.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import numpy as np

try:
    from sklearn.metrics import (
        classification_report, confusion_matrix,
        accuracy_score, f1_score,
    )
    import joblib
except ImportError:
    print("ERROR: scikit-learn not installed.  pip install scikit-learn joblib")
    sys.exit(1)

DATA_PATH   = os.path.join(os.path.dirname(__file__), '..', 'data', 'behaviour_training_data.npz')
MODEL_PATH  = os.path.join(os.path.dirname(__file__), '..', 'core', 'ml_models', 'behaviour_classifier.pkl')
SCALER_PATH = os.path.join(os.path.dirname(__file__), '..', 'core', 'ml_models', 'feature_scaler.pkl')

CLASS_LABELS = ['Normal', 'Warning', 'Suspicious']

# ── Thresholds must mirror SurveillanceAI constants in ai_engine.py ──────────
REL_YAW_NORMAL   = 20
REL_YAW_WARNING  = 35
REL_PITCH_NORMAL = 18
REL_PITCH_WARNING = 28


def _rules_predict(X):
    """Vectorised rule-based zone classification (no time component)."""
    ay = np.abs(X[:, 0])   # rel_yaw
    ap = np.abs(X[:, 1])   # rel_pitch
    y  = np.zeros(len(X), dtype=np.int32)
    y[(ay > REL_YAW_NORMAL) | (ap > REL_PITCH_NORMAL)]     = 1  # warning
    y[(ay > REL_YAW_WARNING) | (ap > REL_PITCH_WARNING)]   = 2  # suspicious
    return y


def _fmt_cm(cm, labels):
    width = max(len(l) for l in labels) + 2
    header = ' ' * width + '  '.join(f'{l:>{width}}' for l in labels)
    rows = []
    for i, row in enumerate(cm):
        rows.append(f'{labels[i]:>{width}}  ' + '  '.join(f'{v:>{width}}' for v in row))
    return '\n'.join([header] + rows)


def main():
    if not os.path.exists(DATA_PATH):
        print(f"Data not found: {DATA_PATH}")
        print("Run: python -m scripts.generate_training_data")
        sys.exit(1)

    data          = np.load(DATA_PATH)
    X, y          = data['X'], data['y']
    n_test        = len(y) // 5
    X_test, y_test = X[-n_test:], y[-n_test:]

    print(f"Test set : {n_test:,} samples (last 20% of dataset)")
    print(f"  Normal     : {(y_test == 0).sum():,}")
    print(f"  Warning    : {(y_test == 1).sum():,}")
    print(f"  Suspicious : {(y_test == 2).sum():,}")

    # ── Rule-based ────────────────────────────────────────────────────────────
    y_rules   = _rules_predict(X_test)
    rules_acc = accuracy_score(y_test, y_rules)
    rules_f1  = f1_score(y_test, y_rules, average='weighted')

    print("\n" + "=" * 60)
    print("  RULE-BASED CLASSIFIER")
    print("=" * 60)
    print(f"  Accuracy       : {rules_acc * 100:.2f}%")
    print(f"  Weighted F1    : {rules_f1:.4f}")
    print()
    print(classification_report(y_test, y_rules, target_names=CLASS_LABELS))
    print("  Confusion matrix:")
    print(_fmt_cm(confusion_matrix(y_test, y_rules), CLASS_LABELS))

    # ── ML-based ──────────────────────────────────────────────────────────────
    if not os.path.exists(MODEL_PATH):
        print(f"\n[SKIP] ML model not found: {MODEL_PATH}")
        print("Run: python -m scripts.train_behaviour_classifier")
        print("\nSummary (rules only):")
        print(f"  Rules  accuracy : {rules_acc * 100:.1f}%")
        return

    clf      = joblib.load(MODEL_PATH)
    scaler   = joblib.load(SCALER_PATH)
    X_test_s = scaler.transform(X_test)
    y_ml     = clf.predict(X_test_s)
    ml_acc   = accuracy_score(y_test, y_ml)
    ml_f1    = f1_score(y_test, y_ml, average='weighted')

    print("\n" + "=" * 60)
    print("  ML GRADIENT BOOSTING CLASSIFIER")
    print("=" * 60)
    print(f"  Accuracy       : {ml_acc * 100:.2f}%")
    print(f"  Weighted F1    : {ml_f1:.4f}")
    print()
    print(classification_report(y_test, y_ml, target_names=CLASS_LABELS))
    print("  Confusion matrix:")
    print(_fmt_cm(confusion_matrix(y_test, y_ml), CLASS_LABELS))

    # ── Summary ───────────────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("  SUMMARY")
    print("=" * 60)
    print(f"  Rules  accuracy : {rules_acc * 100:.1f}%")
    print(f"  ML     accuracy : {ml_acc * 100:.1f}%")
    print(f"  Improvement     : {(ml_acc - rules_acc) * 100:+.1f}%")
    print(f"  ≥ 90% target    : {'PASS ✓' if ml_acc >= 0.90 else 'FAIL ✗'}")
    print("=" * 60)


if __name__ == '__main__':
    main()
