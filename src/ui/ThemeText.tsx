import { Text } from "ink";
import React from "react";
import { resolveColor, useTheme, type ColorToken } from "./theme.js";

/**
 * `<Text>` driven by a theme token instead of separate colour/dim props.
 * Accepts `"cyan"`, `"cyan:dim"`, `"dim"`, or undefined (default foreground,
 * unstyled). All other props (bold, wrap, …) forward to Ink's Text.
 */
export const ThemeText = React.memo(function ThemeText({
  token,
  children,
  ...rest
}: {
  token: ColorToken | undefined;
} & Omit<React.ComponentProps<typeof Text>, "color" | "dimColor">) {
  // Subscribe to theme mutations: without this, React.memo would keep the
  // old colours alive after a live re-apply from /settings.
  useTheme();
  const { color, dim } = resolveColor(token);
  return (
    <Text color={color} dimColor={dim} {...rest}>
      {children}
    </Text>
  );
});
