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

interface Window {
  dataLayer?: unknown[];
}
