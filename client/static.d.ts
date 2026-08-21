declare module "*.svg" {
  import { FunctionComponent, SVGAttributes } from "react";
  const GooglePlayIcon: FunctionComponent<SVGAttributes<SVGElement>>;
  export default GooglePlayIcon;
}

declare module "*.png" {
  export default string;
}

declare module "*.png?inline" {
  export default string;
}

declare module "*.scss";

type GoogleDataLayerEntry = IArguments | Record<string, unknown>;

interface Window {
  dataLayer?: GoogleDataLayerEntry[];
}
