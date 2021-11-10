import { entries, isObject } from "shared/lib/objects";
import { isNull } from "shared/lib/identity";

const cache: Record<string, Record<string, any>> = {};

export class CacheableModel implements Record<string, any> {
  static cacheKey: string;
  static index: string;

  [key: string]: any;

  get class(): typeof CacheableModel {
    return this.constructor as typeof CacheableModel;
  }

  constructor(data: Record<string, any>) {
    if (!this.class.cacheKey) {
      throw new Error("CacheableModel.cacheKey must be set");
    }
    if (!this.class.index) {
      throw new Error("CacheableModel.index must be set");
    }
    Object.assign(this, data);
  }

  static getAll<T extends typeof CacheableModel>(
    this: T
  ): Record<string, InstanceType<T>> {
    return cache[this.cacheKey] ?? {};
  }

  static getOrCreate<T extends typeof CacheableModel>(
    this: T,
    index: string,
    data: Record<string, any>
  ): [InstanceType<T>, boolean] {
    let instance = this.getByIndex(index);
    let wasCreated = false;
    if (isNull(instance)) {
      wasCreated = true;
      instance = new this(data) as InstanceType<T>;
      instance.save();
    }
    return [instance, wasCreated];
  }

  static getByIndex<T extends typeof CacheableModel>(
    this: T,
    index: string
  ): InstanceType<T> | null {
    return cache[this.cacheKey]?.[index] || null;
  }

  /**
   * recursively serializes the CacheableModel calling serialize on any children
   */
  static serialize = <T extends Record<string, any>>(
    input: T,
    flags: Record<string, true> = {}
  ): T => {
    const result = { ...input };
    entries(input).forEach(([key, value]: [keyof T, any]) => {
      if (value instanceof CacheableModel) {
        // serialize models
        result[key] = value.serialize(flags);
      } else if (Array.isArray(value)) {
        // serialize arrays of models
        result[key] = value.map((item) => {
          if (item instanceof CacheableModel) {
            return item.serialize(flags);
          } else {
            return item;
          }
        }) as any;
      } else if (isObject(value)) {
        // serialize objects of models
        result[key] = entries(value).reduce(
          (memo, [key, value]: [string, any]) => {
            if (value instanceof CacheableModel) {
              memo[key] = value.serialize(flags);
            } else {
              memo[key] = value;
            }
            return memo;
          },
          {} as any
        );
      }
    });
    return result;
  };

  getIndex = (): string | null => this[this.class.index] || null;

  save(): void {
    const index = this.getIndex();
    if (isNull(index)) {
      throw new Error(
        `Cannot cache ${this.class.cacheKey} without ${this.class.index}`
      );
    }
    if (!cache[this.class.cacheKey]) {
      cache[this.class.cacheKey] = {};
    }
    cache[this.class.cacheKey][index] = this;
  }

  purge = (): void => {
    const index = this.getIndex();
    if (isNull(index)) {
      return;
    }
    delete cache[this.class.cacheKey][index];
  };

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  update = (data: Record<string, any>) => {
    Object.assign(this, data);
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  serialize(flags: Record<string, true> = {}): any {
    throw new Error("CacheableModel.serialize must be implemented");
  }
}
