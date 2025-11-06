/**
 * Applied Steps Pane - Displays Power Query steps from M code
 */

import React from "react";
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

export function AppliedStepsPane({
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
            <div
              key={step.id}
              className={`applied-steps-item ${
                selectedStepId === step.id ? "applied-steps-item-selected" : ""
              }`}
              onClick={() => onStepClick(step)}
              title={`Line ${step.line}: ${step.name}`}
            >
              <span className="applied-steps-item-name">{step.name}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

