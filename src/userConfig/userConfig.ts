export type ConfigField = {
  key: string;
  type: "text" | "password" | "select" | "bool";
  title: string;
  options?: { key: string; value: string }[];
  default?: string;
};

export type UserConfigData = Record<string, string>;
