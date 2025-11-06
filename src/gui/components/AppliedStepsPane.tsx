/**
 * Applied Steps Pane - Displays Power Query steps from M code
 */

import React, { memo } from "react";
import "./AppliedStepsPane.css";

export interface Step {
  id: string;
  name: string;
  line: number;
}

interface AppliedStepsPaneProps {
  steps: Step[];
  selectedStepId?: string;
  onStepClick: (step: Step) => void;
}

// Memoized step item for performance
const StepItem = memo(({ step, isSelected, onClick }: { step: Step; isSelected: boolean; onClick: () => void }) => (
  <div
    className={`applied-steps-item ${isSelected ? "applied-steps-item-selected" : ""}`}
    onClick={onClick}
    title={`Line ${step.line}: ${step.name}`}
  >
    <span className="applied-steps-item-name">{step.name}</span>
  </div>
));

StepItem.displayName = "StepItem";

export const AppliedStepsPane = memo(function AppliedStepsPane({
  steps,
  selectedStepId,
  onStepClick,
}: AppliedStepsPaneProps) {
  return (
    <div className="applied-steps-pane">
      <div className="applied-steps-header">
        <span className="applied-steps-title">Applied Steps</span>
      </div>
      <div className="applied-steps-list">
        {steps.length === 0 ? (
          <div className="applied-steps-empty">No steps found</div>
        ) : (
          steps.map((step) => (
            <StepItem
              key={step.id}
              step={step}
              isSelected={selectedStepId === step.id}
              onClick={() => onStepClick(step)}
            />
          ))
        )}
      </div>
    </div>
  );
});

