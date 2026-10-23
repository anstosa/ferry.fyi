import { DataTypes, Model } from "sequelize";

import { db } from "~/lib/db";
import type { OpenaiCameraPipelineState as OpenaiCameraPipelineStateValue } from "~/lib/openaiCameraTypes";

// represent the single durable scheduler state row
export class OpenaiCameraPipelineState extends Model {
  key!: string;
  state!: OpenaiCameraPipelineStateValue;
}

// register the bounded json state model
OpenaiCameraPipelineState.init(
  {
    key: {
      allowNull: false,
      primaryKey: true,
      type: DataTypes.STRING(32),
    },
    state: { allowNull: false, type: DataTypes.JSONB },
  },
  {
    sequelize: db,
    modelName: "OpenaiCameraPipelineState",
    tableName: "OpenaiCameraPipelineStates",
  }
);
