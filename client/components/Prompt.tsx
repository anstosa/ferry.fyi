import clsx from "clsx";
import React, {
  FunctionComponent,
  PropsWithChildren,
  ReactNode,
  SVGAttributes,
} from "react";
import { Link } from "react-router-dom";

import { Toast } from "./Toast";

export interface PromptAction {
  Icon?: FunctionComponent<SVGAttributes<SVGElement>>;
  className?: string;
  href?: string;
  label: string;
  onClick?: () => void;
  primary?: boolean;
  to?: string;
}

interface Props {
  actions?: PromptAction[];
  actionsClassName?: string;
  footerDocked?: boolean;
  groupActions?: boolean;
  Icon?: FunctionComponent<SVGAttributes<SVGElement>>;
  level?: "error" | "info" | "warning";
  onClose?: () => void;
  title?: ReactNode;
  top?: boolean;
}

const getActionClasses = (
  action: PromptAction,
  index: number,
  groupActions: boolean
): string =>
  clsx("button truncate", action.className, {
    "alert__button-primary bg-blue-dark border-transparent text-white hover:bg-blue-darkest":
      action.primary,
    "button-group-left": groupActions && index === 0,
    "button-group-right": groupActions && index > 0,
  });

// consistent shell for contextual, user-actionable prompts
export const Prompt: FunctionComponent<PropsWithChildren<Props>> = ({
  actions,
  actionsClassName,
  children,
  footerDocked = false,
  groupActions = true,
  Icon,
  level = "info",
  onClose,
  title,
  top,
}) => (
  <Toast
    error={level === "error"}
    footerDocked={footerDocked}
    Icon={Icon}
    info={level === "info"}
    onClose={onClose}
    top={top}
    warning={level === "warning"}
  >
    {title && <span className="block font-bold">{title}</span>}
    {children}
    {actions?.length ? (
      <div
        className={clsx("mt-5", actionsClassName, {
          "button-group": groupActions,
        })}
      >
        {actions.map((action, index) => {
          const content = (
            <>
              {action.Icon && <action.Icon className="button-icon" />}
              <span className="button-label">{action.label}</span>
            </>
          );
          const className = getActionClasses(action, index, groupActions);

          if (action.to) {
            return (
              <Link className={className} key={action.label} to={action.to}>
                {content}
              </Link>
            );
          }
          if (action.href) {
            return (
              <a className={className} href={action.href} key={action.label}>
                {content}
              </a>
            );
          }
          return (
            <button
              className={className}
              key={action.label}
              onClick={action.onClick}
              type="button"
            >
              {content}
            </button>
          );
        })}
      </div>
    ) : null}
  </Toast>
);
