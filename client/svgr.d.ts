declare module "*.svg" {
  import React from "react";
  const data: React.FC<React.SVGAttributes<SVGElement>>;
  export default data;
}
