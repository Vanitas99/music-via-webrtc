// Copyright (c) 2019 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

const CalculatorModifier = Object.freeze({
    kNone: Object.freeze({postfix: '', multiplier: 1}),
    kMillisecondsFromSeconds:
        Object.freeze({postfix: '_in_ms', multiplier: 1000}),
    kBytesToBits: Object.freeze({bitrate: true, multiplier: 8}),
  });
  
  class Metric {
    constructor(name, value) {
      this.name = name;
      this.value = value;
    }
  
    toString() {
      return '{"' + this.name + '":"' + this.value + '"}';
    }
  }
  
  // Represents a companion dictionary to an RTCStats object of an RTCStatsReport.
  // The CalculatedStats object contains additional metrics associated with the
  // original RTCStats object. Typically, the RTCStats object contains
  // accumulative counters, but in chrome://webrc-internals/ we also want graphs
  // for the average rate over the last second, so we have CalculatedStats
  // containing calculated Metrics.
  class CalculatedStats {
    constructor(id) {
      this.id = id;
      // A map Original Name -> Array of Metrics, where Original Name refers to
      // the name of the metric in the original RTCStats object, and the Metrics
      // are calculated metrics. For example, if the original RTCStats report
      // contains framesReceived, and from that we've calculated
      // [framesReceived/s] and [framesReceived-framesDecoded], then there will be
      // a mapping from "framesReceived" to an array of two Metric objects,
      // "[framesReceived/s]" and "[framesReceived-framesDecoded]".
      this.calculatedMetricsByOriginalName = new Map();
    }
  
    addCalculatedMetric(originalName, metric) {
      let calculatedMetrics =
          this.calculatedMetricsByOriginalName.get(originalName);
      if (!calculatedMetrics) {
        calculatedMetrics = [];
        this.calculatedMetricsByOriginalName.set(originalName, calculatedMetrics);
      }
      calculatedMetrics.push(metric);
    }
  
    // Gets the calculated metrics associated with |originalName| in the order
    // that they were added, or an empty list if there are no associated metrics.
    getCalculatedMetrics(originalName) {
      const calculatedMetrics =
          this.calculatedMetricsByOriginalName.get(originalName);
      if (!calculatedMetrics) {
        return [];
      }
      return calculatedMetrics;
    }
  
    toString() {
      let str = '{id:"' + this.id + '"';
      for (const originalName of this.calculatedMetricsByOriginalName.keys()) {
        const calculatedMetrics =
            this.calculatedMetricsByOriginalName.get(originalName);
        str += ',' + originalName + ':[';
        for (let i = 0; i < calculatedMetrics.length; i++) {
          str += calculatedMetrics[i].toString();
          if (i + 1 < calculatedMetrics.length) {
            str += ',';
          }
          str += ']';
        }
      }
      str += '}';
      return str;
    }
  }
  
  // Contains the metrics of an RTCStatsReport, as well as calculated metrics
  // associated with metrics from the original report. Convertible to and from the
  // "internal reports" format used by webrtc_internals.js to pass stats from C++
  // to JavaScript.
  export class StatsReport {
    constructor() {
      // Represents an RTCStatsReport. It is a Map RTCStats.id -> RTCStats.
      // https://w3c.github.io/webrtc-pc/#dom-rtcstatsreport
      this.statsById = new Map();
      // RTCStats.id -> CalculatedStats
      this.calculatedStatsById = new Map();
    }
  
    // |internalReports| is an array, each element represents an RTCStats object,
    // but the format is a little different from the spec. This is the format:
    // {
    //   id: "string",
    //   type: "string",
    //   stats: {
    //     timestamp: <milliseconds>,
    //     values: ["member1", value1, "member2", value2...]
    //   }
    // }
    static fromInternalsReportList(internalReports) {
      const result = new StatsReport();
      internalReports.forEach(internalReport => {
        if (!internalReport.stats ||??!internalReport.stats.values) {
          return;  // continue;
        }
        const stats = {
          id: internalReport.id,
          type: internalReport.type,
          timestamp: internalReport.stats.timestamp / 1000.0  // ms -> s
        };
        const values = internalReport.stats.values;
        for (let i = 0; i < values.length; i += 2) {
          // Metric "name: value".
          stats[values[i]] = values[i + 1];
        }
        result.statsById.set(stats.id, stats);
      });
      return result;
    }
  
    static fromStatsApiReport(apiReport) {
        const result = new StatsReport();
        result.statsById.set(apiReport.id, apiReport);
        return result;
    }

    toStatsApiReport() {
        const result = [];
        for (const stats of this.statsById.values()) {
            var report = {};
            Object.keys(stats).forEach(metricName => {
                report[metricName] = stats[metricName];
                const rateMetrics = this.getCalculatedMetrics(stats.id, metricName);
                rateMetrics.forEach(rateMetric => {
                    report[rateMetric.name] = rateMetric.value ? rateMetric.value : 0;
                });
            });
            result.push(report)
        }
        return result;
    }

    toInternalsReportList() {
      const result = [];
      for (const stats of this.statsById.values()) {
        const internalReport = {
          id: stats.id,
          type: stats.type,
          stats: {
            timestamp: stats.timestamp * 1000.0,  // s -> ms
            values: []
          }
        };
        Object.keys(stats).forEach(metricName => {
          if (metricName === 'id' || metricName === 'type' ||
              metricName === 'timestamp') {
            return;  // continue;
          }
          internalReport.stats.values.push(metricName);
          internalReport.stats.values.push(stats[metricName]);
          const calculatedMetrics =
              this.getCalculatedMetrics(stats.id, metricName);
          calculatedMetrics.forEach(calculatedMetric => {
            internalReport.stats.values.push(calculatedMetric.name);
            // Treat calculated metrics that are undefined as 0 to ensure graphs
            // can be created anyway.
            internalReport.stats.values.push(
                calculatedMetric.value ? calculatedMetric.value : 0);
          });
        });
        result.push(internalReport);
      }
      return result;
    }
  
    toString() {
      let str = '';
      for (const stats of this.statsById.values()) {
        if (str !== '') {
          str += ',';
        }
        str += JSON.stringify(stats);
      }
      let str2 = '';
      for (const stats of this.calculatedStatsById.values()) {
        if (str2 !== '') {
          str2 += ',';
        }
        str2 += stats.toString();
      }
      return '[original:' + str + '],calculated:[' + str2 + ']';
    }
  
    get(id) {
      return this.statsById.get(id);
    }
  
    getByType(type) {
      const result = [];
      for (const stats of this.statsById.values()) {
        if (stats.type === type) {
          result.push(stats);
        }
      }
      return result;
    }
  
    addCalculatedMetric(id, insertAtOriginalMetricName, name, value) {
      let calculatedStats = this.calculatedStatsById.get(id);
      if (!calculatedStats) {
        calculatedStats = new CalculatedStats(id);
        this.calculatedStatsById.set(id, calculatedStats);
      }
      calculatedStats.addCalculatedMetric(
          insertAtOriginalMetricName, new Metric(name, value));
    }
  
    getCalculatedMetrics(id, originalMetricName) {
      const calculatedStats = this.calculatedStatsById.get(id);
      return calculatedStats ?
          calculatedStats.getCalculatedMetrics(originalMetricName) :
          [];
    }
  }
  
  // Calculates the rate "delta accumulative / delta samples" and returns it. If
  // a rate cannot be calculated, such as the metric is missing in the current
  // or previous report, undefined is returned.
  class RateCalculator {
    constructor(
        accumulativeMetric, samplesMetric, modifier = CalculatorModifier.kNone) {
      this.accumulativeMetric = accumulativeMetric;
      this.samplesMetric = samplesMetric;
      this.modifier = modifier;
    }
  
    getCalculatedMetricName() {
      const accumulativeMetric = this.modifier.bitrate ?
          this.accumulativeMetric + '_in_bits' :
          this.accumulativeMetric;
      if (this.samplesMetric === 'timestamp') {
        return '[' + accumulativeMetric + '/s]';
      }
      return '[' + accumulativeMetric + '/' + this.samplesMetric +
          this.modifier.postfix + ']';
    }
  
    calculate(id, previousReport, currentReport) {
      return RateCalculator.calculateRate(
                 id, previousReport, currentReport, this.accumulativeMetric,
                 this.samplesMetric) *
          this.modifier.multiplier;
    }
  
    static calculateRate(
        id, previousReport, currentReport, accumulativeMetric, samplesMetric) {
      if (!previousReport || !currentReport) {
        return undefined;
      }
      const previousStats = previousReport.get(id);
      const currentStats = currentReport.get(id);
      if (!previousStats || !currentStats) {
        return undefined;
      }
      const deltaTime = currentStats.timestamp - previousStats.timestamp;
      if (deltaTime <= 0) {
        return undefined;
      }
      // Try to convert whatever the values are to numbers. This gets around the
      // fact that some types that are not supported by base::Value (e.g. uint32,
      // int64, uint64 and double) are passed as strings.
      const previousValue = Number(previousStats[accumulativeMetric]);
      const currentValue = Number(currentStats[accumulativeMetric]);
      if (typeof previousValue !== 'number' || typeof currentValue !== 'number') {
        return undefined;
      }
      const previousSamples = Number(previousStats[samplesMetric]);
      const currentSamples = Number(currentStats[samplesMetric]);
      if (typeof previousSamples !== 'number' ||
          typeof currentSamples !== 'number') {
        return undefined;
      }
      const deltaValue = currentValue - previousValue;
      const deltaSamples = currentSamples - previousSamples;
      return deltaValue / deltaSamples;
    }
  }
  
  // Keeps track of previous and current stats report and calculates all
  // calculated metrics.
  export class StatsRatesCalculator {
    constructor() {
      this.previousReport = null;
      this.currentReport = null;
    }
  
    addStatsReport(report) {
      this.previousReport = this.currentReport;
      this.currentReport = report;
      this.updateCalculatedMetrics_();
    }
  
    // Updates all "calculated metrics", which are metrics derived from standard
    // values, such as converting total counters (e.g. bytesSent) to rates (e.g.
    // bytesSent/s).
    updateCalculatedMetrics_() {
      const statsCalculators = [
        {
          type: 'outbound-rtp',
          metricCalculators: {
            bytesSent: new RateCalculator(
                'bytesSent', 'timestamp', CalculatorModifier.kBytesToBits),
            headerBytesSent: new RateCalculator(
                'headerBytesSent', 'timestamp', CalculatorModifier.kBytesToBits),
            packetsSent: new RateCalculator('packetsSent', 'timestamp'),
          },
        },
        {
          type: 'inbound-rtp',
          metricCalculators: {
            bytesReceived: new RateCalculator(
                'bytesReceived', 'timestamp', CalculatorModifier.kBytesToBits),
            headerBytesReceived: new RateCalculator(
                'headerBytesReceived', 'timestamp',
                CalculatorModifier.kBytesToBits),
            concealedSamples: [
              new RateCalculator('concealedSamples', 'timestamp'),
              new RateCalculator('concealedSamples', 'totalSamplesReceived'),
            ],
            silentConcealedSamples:
                new RateCalculator('silentConcealedSamples', 'timestamp'),
            insertedSamplesForDeceleration:
                new RateCalculator('insertedSamplesForDeceleration', 'timestamp'),
            removedSamplesForAcceleration:
                new RateCalculator('removedSamplesForAcceleration', 'timestamp'),
            jitterBufferDelay: new RateCalculator(
                'jitterBufferDelay', 'jitterBufferEmittedCount',
                CalculatorModifier.kMillisecondsFromSeconds),
          },
        },
      ];
      statsCalculators.forEach(statsCalculator => {
        this.currentReport.getByType(statsCalculator.type).forEach(stats => {
          Object.keys(statsCalculator.metricCalculators)
              .forEach(originalMetric => {
                let metricCalculators =
                    statsCalculator.metricCalculators[originalMetric];
                if (!Array.isArray(metricCalculators)) {
                  metricCalculators = [metricCalculators];
                }
                metricCalculators.forEach(metricCalculator => {
                  this.currentReport.addCalculatedMetric(
                      stats.id, originalMetric,
                      metricCalculator.getCalculatedMetricName(),
                      metricCalculator.calculate(
                          stats.id, this.previousReport, this.currentReport));
                });
              });
        });
      });
    }
  }
  