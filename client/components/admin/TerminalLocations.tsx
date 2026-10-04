import clsx from "clsx";
import React, {
  type ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type AdminTerminalLocation,
  isTerminalPoint,
  type TerminalPoint,
} from "shared/contracts/terminalLocations";

import { confirmationPhrase } from "~/lib/adminConfirmation";
import { put } from "~/lib/api";
import { refreshTerminalLocations } from "~/lib/terminals";

import {
  TerminalLocationMap,
  type TerminalPointKind,
} from "./TerminalLocationMap";

interface PointFields {
  latitude: string;
  longitude: string;
}

interface Draft {
  booth: PointFields;
  dock: PointFields;
}

interface RenderSaveProps {
  disabled: boolean;
  label: string;
  onConfirm: () => Promise<void>;
  target: string;
}

interface Props {
  onSaved: (terminal: AdminTerminalLocation) => void;
  renderSave: (props: RenderSaveProps) => ReactElement;
  terminals: AdminTerminalLocation[];
  token: () => Promise<string>;
}

interface ParsedPoint {
  error: string | null;
  value: TerminalPoint | null;
}

// translate one saved point into editable strings
const pointFields = (point: TerminalPoint | null): PointFields => ({
  latitude: point ? String(point.latitude) : "",
  longitude: point ? String(point.longitude) : "",
});

// create an isolated terminal draft
const terminalDraft = (terminal: AdminTerminalLocation): Draft => ({
  booth: pointFields(terminal.booth),
  dock: pointFields(terminal.dock),
});

// validate one nullable coordinate pair
const parsePoint = (fields: PointFields, label: string): ParsedPoint => {
  const latitudeInput = fields.latitude.trim();
  const longitudeInput = fields.longitude.trim();
  // treat two empty fields as an intentional clear
  if (!latitudeInput && !longitudeInput) {
    return { error: null, value: null };
  }
  // require a complete coordinate pair
  if (!latitudeInput || !longitudeInput) {
    return {
      error: `${label} requires both latitude and longitude.`,
      value: null,
    };
  }
  const value = {
    latitude: Number(latitudeInput),
    longitude: Number(longitudeInput),
  };
  // enforce the shared washington ferry region
  if (!isTerminalPoint(value)) {
    return {
      error: `${label} must be within latitude 45–50 and longitude -125–-119.`,
      value: null,
    };
  }
  return { error: null, value };
};

// compare nullable geographic points exactly
const samePoint = (
  left: TerminalPoint | null,
  right: TerminalPoint | null
): boolean =>
  left === right ||
  Boolean(
    left &&
    right &&
    left.latitude === right.latitude &&
    left.longitude === right.longitude
  );

// edit the booth and dock points for one terminal at a time
export const TerminalLocations = ({
  onSaved,
  renderSave,
  terminals,
  token,
}: Props): ReactElement => {
  const [selectedTerminalId, setSelectedTerminalId] = useState(
    terminals[0]?.terminalId ?? ""
  );
  const selectedTerminal =
    terminals.find(({ terminalId }) => terminalId === selectedTerminalId) ??
    terminals[0];
  const [draft, setDraft] = useState<Draft>(() =>
    selectedTerminal
      ? terminalDraft(selectedTerminal)
      : { booth: pointFields(null), dock: pointFields(null) }
  );
  const [selectedPoint, setSelectedPoint] =
    useState<TerminalPointKind>("booth");
  const [refreshWarning, setRefreshWarning] = useState<string | null>(null);
  const selectedTerminalRef = useRef(selectedTerminal?.terminalId ?? "");

  // replace the draft only when its terminal changes or saves
  useEffect(() => {
    // wait for terminal data
    if (!selectedTerminal) {
      return;
    }
    selectedTerminalRef.current = selectedTerminal.terminalId;
    setSelectedTerminalId(selectedTerminal.terminalId);
    setDraft(terminalDraft(selectedTerminal));
  }, [selectedTerminal]);

  // validate the booth draft
  const booth = useMemo(
    () => parsePoint(draft.booth, "Booth point"),
    [draft.booth]
  );
  // validate the dock draft
  const dock = useMemo(
    () => parsePoint(draft.dock, "Dock point"),
    [draft.dock]
  );
  const changed = Boolean(
    selectedTerminal &&
    !booth.error &&
    !dock.error &&
    (!samePoint(booth.value, selectedTerminal.booth) ||
      !samePoint(dock.value, selectedTerminal.dock))
  );

  // replace one valid draft point from the map
  const updateMapPoint = (
    kind: TerminalPointKind,
    point: TerminalPoint
  ): void => {
    setDraft((current) => ({
      ...current,
      [kind]: pointFields(point),
    }));
  };

  // save both points as one confirmed update
  const save = async (): Promise<void> => {
    // block missing or invalid drafts
    if (!selectedTerminal || booth.error || dock.error) {
      throw new Error("Enter valid booth and dock coordinates before saving.");
    }
    const { terminalId } = selectedTerminal;
    const target = `terminal:${terminalId}`;
    setRefreshWarning(null);
    const result = await put<AdminTerminalLocation>(
      `/admin/terminal-locations/${encodeURIComponent(terminalId)}`,
      {
        action: "save-terminal-locations",
        booth: booth.value,
        confirmation: confirmationPhrase("save-terminal-locations", target),
        dock: dock.value,
        target,
      },
      await token()
    );
    onSaved(result);
    // avoid replacing a newer terminal's draft
    if (selectedTerminalRef.current === terminalId) {
      setDraft(terminalDraft(result));
    }
    try {
      await refreshTerminalLocations(terminalId);
    } catch {
      // report cache refresh separately from the committed save
      setRefreshWarning(
        "Terminal locations were saved, but the public terminal cache could not be refreshed. Reload before verifying public map updates."
      );
    }
  };

  // retain an explicit empty state
  if (!selectedTerminal) {
    return <p className="mt-4 text-sm">No terminals are available.</p>;
  }

  const target = `terminal:${selectedTerminal.terminalId}`;

  return (
    <div className="mt-4 space-y-5">
      <label className="block font-semibold" htmlFor="terminal-location">
        Terminal
      </label>
      <select
        className="w-full rounded-xl border border-gray-medium bg-white p-3 text-gray-900 dark:bg-blue-darkest dark:text-gray-100"
        id="terminal-location"
        onChange={(event) => {
          // switch drafts without mutating either terminal
          selectedTerminalRef.current = event.target.value;
          setSelectedTerminalId(event.target.value);
          setSelectedPoint("booth");
        }}
        value={selectedTerminal.terminalId}
      >
        {terminals.map((terminal) => (
          <option key={terminal.terminalId} value={terminal.terminalId}>
            {terminal.name} ({terminal.abbreviation})
          </option>
        ))}
      </select>

      <div>
        <p className="font-semibold">Map editing target</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {(
            [
              ["booth", "Toll booth / navigation"],
              ["dock", "Dock / public map"],
            ] as const
          ).map(([kind, label]) => (
            <button
              aria-pressed={selectedPoint === kind}
              className={clsx(
                "rounded-xl border px-3 py-3 text-sm font-semibold",
                selectedPoint === kind
                  ? "border-green-dark bg-green-dark text-white"
                  : "border-gray-medium bg-white hover:border-green-dark dark:border-gray-dark dark:bg-blue-darkest dark:hover:border-green-light"
              )}
              key={kind}
              onClick={() => {
                // center the crosshair on this point
                setSelectedPoint(kind);
              }}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-sm text-gray-dark dark:text-gray-light">
          Move the map under the crosshair to position the selected point.
        </p>
      </div>

      <TerminalLocationMap
        booth={booth.error ? null : booth.value}
        defaultDock={selectedTerminal.defaultDock}
        dock={dock.error ? null : dock.value}
        onChange={updateMapPoint}
        selected={selectedPoint}
        terminalId={selectedTerminal.terminalId}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {(
          [
            {
              description: "Used for leave-now travel estimates.",
              kind: "booth",
              label: "Toll booth point",
              parsed: booth,
            },
            {
              description: "Used on the public terminal map.",
              kind: "dock",
              label: "Dock point",
              parsed: dock,
            },
          ] as const
        ).map(({ description, kind, label, parsed }) => (
          <fieldset
            className="rounded-xl border border-gray-light p-4 dark:border-gray-dark"
            key={kind}
          >
            <legend className="px-1 font-semibold">{label}</legend>
            <p className="text-sm text-gray-dark dark:text-gray-light">
              {description}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="text-sm font-semibold">
                Latitude
                <input
                  aria-label={`${label} latitude`}
                  className="mt-1 w-full rounded-lg border border-gray-medium bg-white p-2 text-gray-900 dark:bg-blue-darkest dark:text-gray-100"
                  inputMode="decimal"
                  onChange={(event) => {
                    // update one manual latitude
                    setDraft((current) => ({
                      ...current,
                      [kind]: {
                        ...current[kind],
                        latitude: event.target.value,
                      },
                    }));
                  }}
                  step="any"
                  type="number"
                  value={draft[kind].latitude}
                />
              </label>
              <label className="text-sm font-semibold">
                Longitude
                <input
                  aria-label={`${label} longitude`}
                  className="mt-1 w-full rounded-lg border border-gray-medium bg-white p-2 text-gray-900 dark:bg-blue-darkest dark:text-gray-100"
                  inputMode="decimal"
                  onChange={(event) => {
                    // update one manual longitude
                    setDraft((current) => ({
                      ...current,
                      [kind]: {
                        ...current[kind],
                        longitude: event.target.value,
                      },
                    }));
                  }}
                  step="any"
                  type="number"
                  value={draft[kind].longitude}
                />
              </label>
            </div>
            {parsed.error && (
              <p className="mt-2 text-sm text-red-dark" role="alert">
                {parsed.error}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                className="button button-secondary button-small"
                onClick={() => {
                  // clear this nullable point draft
                  setDraft((current) => ({
                    ...current,
                    [kind]: pointFields(null),
                  }));
                }}
                type="button"
              >
                Clear {kind} point
              </button>
              {kind === "dock" &&
                selectedTerminal.defaultDock &&
                !dock.value && (
                  <button
                    className="button button-secondary button-small"
                    onClick={() => {
                      // copy the visible wsf fallback into the admin draft
                      updateMapPoint("dock", selectedTerminal.defaultDock!);
                    }}
                    type="button"
                  >
                    Use WSF dock location
                  </button>
                )}
            </div>
          </fieldset>
        ))}
      </div>

      {!dock.value && selectedTerminal.defaultDock && (
        <p className="rounded-lg bg-gray-lightest p-3 text-sm dark:bg-blue-darkest">
          Dock location: WSF fallback. It remains a fallback until an admin dock
          point is saved.
        </p>
      )}
      {!booth.value && !booth.error && (
        <p className="text-sm text-amber-800 dark:text-amber-300">
          Toll booth point is unset. Leave-now routing is unavailable for this
          terminal until it is saved.
        </p>
      )}
      {selectedTerminal.updatedAt && (
        <p className="text-xs text-gray-dark dark:text-gray-light">
          Last saved {new Date(selectedTerminal.updatedAt).toLocaleString()}.
        </p>
      )}
      {refreshWarning && (
        <p
          className="rounded-lg bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200"
          role="status"
        >
          {refreshWarning}
        </p>
      )}
      {renderSave({
        disabled: !changed || Boolean(booth.error || dock.error),
        label: "Save terminal locations",
        onConfirm: save,
        target,
      })}
    </div>
  );
};
