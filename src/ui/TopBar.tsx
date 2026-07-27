import { Box, Text } from "ink";
import React from "react";
import { getVersionInfo } from "../version.js";

// Persistent topbar, docked above the scroll viewport. Shows the workspace
// directory on the left and the build date on the right, on a light-blue
// background band that spans the full terminal width.
export const TopBar = React.memo(function TopBar() {
  const { commitDate } = getVersionInfo();
  return (
    <Box backgroundColor="cyan" justifyContent="space-between" flexShrink={0} paddingLeft={1} paddingRight={1}>
      <Text color="black" bold>{`axle-code: ${process.cwd()}`}</Text>
      <Text color="black" bold>{`build-${commitDate}`}</Text>
    </Box>
  );
});
