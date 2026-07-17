import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import React from "react";
import type { Annotation } from "@fifthrevision/axle/ui";

const STATUS_COLOR: Record<string, string> = {
  running: "cyan",
  complete: "green",
  cancelled: "yellow",
  error: "red",
};

export const AnnotationBar = React.memo(function AnnotationBar({ annotations }: { annotations: Annotation[] }) {
  if (annotations.length === 0) return null;
  return (
    <Box flexDirection="column" marginTop={1}>
      {annotations.map((a) => (
        <Box key={a.id}>
          <Box marginRight={1}>
            {a.status === "running" ? (
              <Text color="cyan">
                <Spinner type="dots" />
              </Text>
            ) : (
              <Text color={a.status ? STATUS_COLOR[a.status] ?? "gray" : "gray"}>◆</Text>
            )}
          </Box>
          <Text>{a.label}</Text>
        </Box>
      ))}
    </Box>
  );
});
