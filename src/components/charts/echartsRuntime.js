import * as echarts from 'echarts/core'
import {
  BarChart, CustomChart, GaugeChart, HeatmapChart, LineChart, PieChart,
  SankeyChart, ScatterChart, TreemapChart,
} from 'echarts/charts'
import {
  AriaComponent, DataZoomComponent, DatasetComponent, GridComponent,
  LegendComponent, MarkAreaComponent, MarkLineComponent, TitleComponent,
  ToolboxComponent, TooltipComponent, TransformComponent, VisualMapComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([
  BarChart, CustomChart, GaugeChart, HeatmapChart, LineChart, PieChart,
  SankeyChart, ScatterChart, TreemapChart, CanvasRenderer,
  AriaComponent, DataZoomComponent, DatasetComponent, GridComponent,
  LegendComponent, MarkAreaComponent, MarkLineComponent, TitleComponent,
  ToolboxComponent, TooltipComponent, TransformComponent, VisualMapComponent,
])

export default echarts
