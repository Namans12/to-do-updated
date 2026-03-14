interface GraphBoundaryOverlayProps {
  canvasWidth: number;
  canvasHeight: number;
  draggingNode: string | null;
  nearBoundary: { right: boolean; bottom: boolean };
}

export default function GraphBoundaryOverlay({
  canvasWidth,
  canvasHeight,
  draggingNode,
  nearBoundary,
}: GraphBoundaryOverlayProps) {
  if ((!nearBoundary.right && !nearBoundary.bottom) || !draggingNode) {
    return null;
  }

  return (
    <div
      className="absolute left-0 top-0 pointer-events-none"
      style={{
        width: canvasWidth,
        height: canvasHeight,
        zIndex: 250,
      }}
    >
      <div
        className="absolute inset-0"
        style={{
          borderTopRightRadius: 18,
          borderBottomRightRadius: 18,
          borderBottomLeftRadius: 18,
          boxShadow:
            "inset -10px 0 18px -16px rgba(253,224,71,0.9), inset 0 -10px 18px -16px rgba(253,224,71,0.9)",
        }}
      >
        {nearBoundary.right && (
          <>
            <div
              className="absolute"
              style={{
                top: 18,
                right: 0,
                bottom: 18,
                borderRight: "2px dotted rgba(253,224,71,0.95)",
                filter: "drop-shadow(0 0 6px rgba(253,224,71,0.95))",
              }}
            />
            <div
              className="absolute"
              style={{
                top: 0,
                right: 0,
                width: 18,
                height: 18,
                borderTop: "2px dotted rgba(253,224,71,0.9)",
                borderRight: "2px dotted rgba(253,224,71,0.95)",
                borderTopRightRadius: 18,
                filter: "drop-shadow(0 0 6px rgba(253,224,71,0.9))",
              }}
            />
          </>
        )}
        {nearBoundary.bottom && (
          <>
            <div
              className="absolute"
              style={{
                left: 18,
                right: 18,
                bottom: 0,
                borderBottom: "2px dotted rgba(253,224,71,0.95)",
                filter: "drop-shadow(0 0 6px rgba(253,224,71,0.95))",
              }}
            />
            <div
              className="absolute"
              style={{
                left: 0,
                bottom: 0,
                width: 18,
                height: 18,
                borderLeft: "2px dotted rgba(253,224,71,0.9)",
                borderBottom: "2px dotted rgba(253,224,71,0.95)",
                borderBottomLeftRadius: 18,
                filter: "drop-shadow(0 0 6px rgba(253,224,71,0.9))",
              }}
            />
          </>
        )}
        {(nearBoundary.right || nearBoundary.bottom) && (
          <div
            className="absolute"
            style={{
              right: 0,
              bottom: 0,
              width: 18,
              height: 18,
              borderRight: "2px dotted rgba(253,224,71,0.95)",
              borderBottom: "2px dotted rgba(253,224,71,0.95)",
              borderBottomRightRadius: 18,
              filter: "drop-shadow(0 0 7px rgba(253,224,71,0.95))",
            }}
          />
        )}
      </div>
    </div>
  );
}
