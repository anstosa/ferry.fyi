import { faArrowLeft } from "@fortawesome/free-solid-svg-icons/faArrowLeft";
import { faArrowRight } from "@fortawesome/free-solid-svg-icons/faArrowRight";
import { faCheck } from "@fortawesome/free-solid-svg-icons/faCheck";
import { faCircle } from "@fortawesome/free-solid-svg-icons/faCircle";
import { faCrosshairs } from "@fortawesome/free-solid-svg-icons/faCrosshairs";
import { faEraser } from "@fortawesome/free-solid-svg-icons/faEraser";
import { faExpand } from "@fortawesome/free-solid-svg-icons/faExpand";
import { faFloppyDisk } from "@fortawesome/free-solid-svg-icons/faFloppyDisk";
import { faForwardStep } from "@fortawesome/free-solid-svg-icons/faForwardStep";
import { faMagnifyingGlassMinus } from "@fortawesome/free-solid-svg-icons/faMagnifyingGlassMinus";
import { faMagnifyingGlassPlus } from "@fortawesome/free-solid-svg-icons/faMagnifyingGlassPlus";
import { faPen } from "@fortawesome/free-solid-svg-icons/faPen";
import { faPlus } from "@fortawesome/free-solid-svg-icons/faPlus";
import { faRotate } from "@fortawesome/free-solid-svg-icons/faRotate";
import { faRotateLeft } from "@fortawesome/free-solid-svg-icons/faRotateLeft";
import { faTrashCan } from "@fortawesome/free-solid-svg-icons/faTrashCan";

interface FontAwesomeIconDefinition {
  icon: [number, number, string[], string, string | string[]];
}

const icons: Array<[string, FontAwesomeIconDefinition]> = [
  ["icon-arrow-left", faArrowLeft],
  ["icon-arrow-right", faArrowRight],
  ["icon-check", faCheck],
  ["icon-circle", faCircle],
  ["icon-eraser", faEraser],
  ["icon-maximize", faExpand],
  ["icon-pencil", faPen],
  ["icon-plus", faPlus],
  ["icon-refresh", faRotate],
  ["icon-save", faFloppyDisk],
  ["icon-scan", faCrosshairs],
  ["icon-skip-next", faForwardStep],
  ["icon-trash", faTrashCan],
  ["icon-undo", faRotateLeft],
  ["icon-zoom-in", faMagnifyingGlassPlus],
  ["icon-zoom-out", faMagnifyingGlassMinus],
];

// render one directly imported icon definition
const renderSymbol = ([id, definition]: [
  string,
  FontAwesomeIconDefinition,
]): string => {
  const [width, height, , , paths] = definition.icon;
  const pathList = Array.isArray(paths) ? paths : [paths];
  // render every path in the selected icon only
  const body = pathList.map((path) => `<path d="${path}"/>`).join("");
  return `<symbol id="${id}" viewBox="0 0 ${width} ${height}">${body}</symbol>`;
};

// create the subset sprite shared by both development servers
export const renderCameraDetectionIconSprite = (): string =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<svg xmlns="http://www.w3.org/2000/svg">',
    "<!-- Font Awesome Free 7.3.1 by Fonticons, Inc. https://fontawesome.com License: CC BY 4.0 -->",
    "<defs>",
    ...icons.map(renderSymbol),
    "</defs>",
    "</svg>",
    "",
  ].join("\n");

export const cameraDetectionIconCount = icons.length;
