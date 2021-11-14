import { entries } from "./objects";
import { isNil } from "./identity";

export const without = <T>(array: T[] = [], element: T, key?: keyof T): T[] => {
  if (key) {
    return array.filter((item) => item[key] !== element[key]);
  } else {
    const targetIndex = array.indexOf(element);
    if (targetIndex === -1) {
      return array;
    } else {
      return array.filter((value, index) => index !== targetIndex);
    }
  }
};

export const isArray = (input: unknown): input is any[] => Array.isArray(input);

export const isEmpty = (input: unknown[] | null | undefined): boolean => {
  if (isNil(input)) {
    return true;
  }
  return input.length === 0;
};

// eslint-disable-next-line @typescript-eslint/ban-types
export const keyBy = <T extends object>(
  array: T[],
  key: keyof T
): Record<any, T> => {
  const result: Record<any, T> = {};
  array.forEach((object) => {
    const index = object[key] as any;
    result[index] = object as T;
  });
  return result;
};

export enum Order {
  DESC = "desc",
  ASC = "asc",
}

export const sortBy = <T extends Record<string, any>>(
  input: T[],
  key: keyof T,
  order: Order = Order.ASC
): T[] => {
  const compare = (a: T, b: T): -1 | 0 | 1 => {
    if (a[key] < b[key]) {
      return order === Order.ASC ? -1 : 1;
    } else if (a[key] > b[key]) {
      return order === Order.ASC ? 1 : -1;
    } else {
      return 0;
    }
  };

  return input.sort(compare);
};

export const findWhere = <T extends Record<string, any>>(
  input: T[] | null | undefined,
  target: Record<string, unknown>
): T | undefined => {
  if (isNil(input)) {
    return;
  }
  return input.find((element) => {
    return entries(target).every(([key, value]) => {
      return element[key] === value;
    });
  });
};
