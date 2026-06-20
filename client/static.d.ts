declare module "*.svg" {
  import { FunctionComponent, SVGAttributes } from "react";
  const GooglePlayIcon: FunctionComponent<SVGAttributes<SVGElement>>;
  export default GooglePlayIcon;
}

declare module "*.png" {
  export default string;
}

declare module "*.scss";

declare const gtag: Gtag.Gtag;

interface Window {
  gtag?: Gtag.Gtag;
}
