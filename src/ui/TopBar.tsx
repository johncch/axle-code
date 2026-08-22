import { Box, Text } from "ink";
import React from "react";
import { getVersionInfo } from "../version.js";
import { theme } from "./theme.js";

// Persistent topbar, docked above the scroll viewport. Shows the workspace
// directory on the left and the build date on the right, on an accent-colour
// background band that spans the full terminal width.
export const TopBar = React.memo(function TopBar() {
  const { commitDate } = getVersionInfo();
  return (
    <Box backgroundColor={theme.accent} justifyContent="space-between" flexShrink={0} paddingX={2}>
      <Text color={theme.onAccent} bold>{`axle-code: ${process.cwd()}`}</Text>
      <Text color={theme.onAccent} bold>{`build-${commitDate}`}</Text>
    </Box>
  );
});
