import { useLocation } from "react-router-dom";

export const useQuery = (): Record<string, string> => {
  const query = useLocation().search.slice(1);
  const pairs = query.split("&");
  const result: Record<string, string> = {};
  pairs.forEach((pair) => {
    const [key, value] = pair.split("=");
    result[key] = value;
  });
  return result;
};
