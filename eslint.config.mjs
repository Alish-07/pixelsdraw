import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = [
  ...nextCoreWebVitals,
  {
    ignores: [".next/**", ".next-build/**", "node_modules/**"],
  },
];

export default eslintConfig;
