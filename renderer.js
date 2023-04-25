const log = require("electron-log");
const Vue = require("vue/dist/vue.min.js");
const fs = window.require("fs");
const si = require("systeminformation");
const ffmpegPath = require("ffmpeg-static-electron").path;
const ffmpeg = require("fluent-ffmpeg");
const path = require("path");
const { exec, spawn } = require("child_process");
ffmpeg.setFfmpegPath(ffmpegPath);

log.transports.file.maxSize = 10 * 1024 * 1024; // 10MB
log.transports.file.level = "info";
log.transports.file.file = "logs/app.log";
log.transports.file.datePattern = "YYYY-MM-DD"; // 按天生成日志

log.info("myRecorder start......");
log.info(
  "chrome version:" +
    process.versions["chrome"] +
    ",node version:" +
    process.versions["node"] +
    ",electron version:" +
    process.versions["electron"]
);

let app = new Vue({
  el: "#app",
  data: {
    videoConstraints: {
      audio: false,
      video: {
        width: 1280,
        height: 720,
        deviceId: {
          exact: null,
        },
        frameRate: { ideal: 10, max: 10 },
      },
    },
    audioConstraints: {
      audio: {
        deviceId: {
          exact: null,
        },
      },
    },
    lxStream: null,
    volumStream: null,
    videoDevices: [],
    videoDevice: "",
    audioDevices: [],
    audioDevice: "",
    frameRates: [
      "640 x 480",
      "800 x 600",
      "1280 x 720",
      "1920 x 1080",
      "2560 x 1440",
      "3840 x 2160",
    ],
    frameRate: "",
    ratios: [30, 25, 20, 15, 10, 5, 1],
    ratio: 15,
    filepath: "",
    mediaRecorder: null,
    videoName: "",
    mp4VideoMp4: "",
    resolutionX: 1280,
    resolutionY: 720,
    recordState: true,
    recordcState: false,
    cameraDisabled: false,
    recordingDisabled: false,
    startDisabled: false,
    stopDisabled: true,
    fileData: [],
  },
  created() {
    let _this = this;
    //初始化视频存放目录
    _this.filepath = path.resolve(__dirname, "video") + "\\";
    log.info(_this.filepath);
    fs.mkdirSync(_this.filepath, {
      recursive: true,
    });
    _this.getAllFiles(_this.filepath);
    log.info(_this.fileData);
    _this.initDevices();
    si.graphics()
      .then((data) => {
        const { resolutionX, resolutionY } = data.displays[0];
        log.info(`录屏分辨率: ${resolutionX}x${resolutionY}`);
        _this.resolutionX = resolutionX;
        _this.resolutionY = resolutionY;
      })
      .catch((error) => log.info(error));
  },
  updated() {
    let _this = this;
    // 假设tableId是你的Layui表格的DOM元素ID，tableData是你绑定到Vue上的数据
    layui.table.reload("tab", {
      data: _this.fileData,
    });

    layui.form.render(); // 渲染全部
  },
  methods: {
    async initDevices() {
      let _this = this;
      //初始化录制设备选型
      const devices = await navigator.mediaDevices.enumerateDevices();
      log.info("初始化获取设备...");
      log.info(devices);
      devices.forEach((element) => {
        if (element.kind === "audioinput") {
          _this.audioDevices.push(element);
        }
        if (element.kind === "videoinput") {
          _this.videoDevices.push(element);
        }
      });
      _this.audioDevice = _this.audioDevices[0].deviceId;
      _this.videoDevice = _this.videoDevices[0].deviceId;
      _this.frameRate = _this.frameRates[0];
    },
    getAllFiles(dirPath) {
      let _this = this;
      let files = fs.readdirSync(dirPath);
      files.forEach(function (file) {
        fs.stat(dirPath + file, (err, stats) => {
          if (err) throw err;
          if (stats.isFile() && file.split(".")[1] == "mp4") {
            //如果是mp4文件
            let mp4Info = {
              fileName: file,
              fileSize: (stats.size / 1024 / 1024).toFixed(2) + "M",
              mtime: _this.getDateTime1(stats.mtime),
              sortTime: stats.mtime.getTime(),
            };
            if (!_this.containsObject(mp4Info, _this.fileData)) {
              _this.fileData.push(mp4Info);
              _this.fileData.sort((a, b) => b.sortTime - a.sortTime);
              mp4Info = {};
            }
          }
        });
      });
    },
    containsObject(obj, list) {
      return list.some(
        (elem) =>
          elem.fileName === obj.fileName && elem.fileSize === obj.fileSize
      );
    },
    //录像
    async start() {
      let _this = this;
      _this.startDisabled = true;
      _this.stopDisabled = false;
      _this.$refs.start.classList.add("layui-btn-disabled");
      _this.$refs.stop.classList.remove("layui-btn-disabled");
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (_this.cameraDisabled) {
          //录屏
          _this.lxStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              mandatory: {
                chromeMediaSource: "screen",
                minWidth: _this.resolutionX,
                maxWidth: _this.resolutionX,
                minHeight: _this.resolutionY,
                maxHeight: _this.resolutionY,
              },
            },
          });
        } else {
          //录像
          _this.videoConstraints.video.deviceId = _this.videoDevice;
          _this.videoConstraints.video.width = _this.frameRate.split("x")[0];
          _this.videoConstraints.video.height = _this.frameRate.split("x")[1];
          _this.videoConstraints.video.frameRate.ideal = _this.ratio;
          _this.videoConstraints.video.frameRate.max = _this.ratio;

          _this.lxStream = await navigator.mediaDevices.getUserMedia(
            _this.videoConstraints
          );
        }

        _this.$refs.recordVideo.srcObject = _this.lxStream;

        _this.audioConstraints.audio.deviceId = _this.audioDevice;
        _this.volumStream = await navigator.mediaDevices.getUserMedia(
          _this.audioConstraints
        );

        const tracks = _this.volumStream.getAudioTracks();
        tracks.forEach(function (track) {
          if (!_this.recordingDisabled) {
            track.enabled = true;
          } else {
            track.enabled = false;
          }
        });

        _this.lxStream
          .getVideoTracks()
          .forEach((value) => _this.volumStream.addTrack(value));
        _this.recorder(_this.volumStream);
      } catch (e) {
        log.info(e);
      }
    },
    stop() {
      let _this = this;
      _this.mediaRecorder.stop();
      _this.closeStream(_this.lxStream);
      _this.closeStream(_this.volumStream);
      _this.lxStream = null;
      _this.volumStream = null;
      _this.startDisabled = false;
      _this.stopDisabled = true;
      _this.$refs.stop.classList.add("layui-btn-disabled");
      _this.$refs.start.classList.remove("layui-btn-disabled");
      ffmpeg(_this.filepath + _this.videoName)
        .outputOptions("-c:v", "copy")
        .output(_this.filepath + _this.mp4VideoMp4)
        .on("end", function () {
          log.info(_this.filepath + _this.mp4VideoMp4 + "转换完成！");
          fs.unlink(_this.filepath + _this.videoName, (err) => {
            if (err) {
              log.info(
                "垃圾文件" + _this.filepath + _this.videoName + "删除失败！"
              );
            }
            log.info("文件已成功删除！");
            _this.getAllFiles(_this.filepath);
          });
        })
        .run();
    },
    camera() {
      let _this = this;
      if (!_this.startDisabled) {
        _this.cameraDisabled = false;
        _this.$refs.camera.style.boxShadow = "0 2px 4px rgba(0, 0, 0, 0.3)";
        _this.$refs.screen.style.boxShadow = "none";
      }
    },
    screen() {
      let _this = this;
      if (!_this.startDisabled) {
        _this.cameraDisabled = true;
        _this.$refs.screen.style.boxShadow = "0 2px 4px rgba(0, 0, 0, 0.3)";
        _this.$refs.camera.style.boxShadow = "none";
      }
    },
    recording() {
      let _this = this;
      _this.recordState = !_this.recordState;
      _this.recordcState = !_this.recordcState;
      if (!_this.recordState) {
        _this.recordingDisabled = true;
      } else {
        _this.recordingDisabled = false;
      }
    },
    async handleDataAvailable(e) {
      let _this = this;
      try {
        const tracks = _this.mediaRecorder.stream.getAudioTracks();
        tracks.forEach(function (track) {
          if (!_this.recordingDisabled) {
            track.enabled = true;
          } else {
            track.enabled = false;
          }
        });

        fs.appendFileSync(
          _this.filepath + _this.videoName,
          new Uint8Array(await e.data.arrayBuffer())
        );
      } catch (e) {
        log.info(e);
      }
    },
    recorder(stream) {
      let _this = this;
      try {
        const options = {
          audioBitsPerSecond: 128000,
          videoBitsPerSecond: 2500000,
          mimeType: "video/webm;codecs=h264",
        };
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
          log.info("该浏览器不支持当前视频格式！");
          return;
        }
        _this.mediaRecorder = new MediaRecorder(stream, options);
        _this.mediaRecorder.start(500);
        _this.videoName = "ME录制" + _this.getDateTime(new Date()) + ".webm";
        log.info("开始录制：" + _this.filepath + _this.videoName);
        _this.mp4VideoMp4 = _this.videoName.split(".")[0] + ".mp4";
        _this.mediaRecorder.ondataavailable =
          _this.handleDataAvailable.bind(_this);
      } catch (e) {
        log.info(e);
      }
    },
    //判空
    isNullValue(value) {
      if (value === "" || value === undefined || value === null) {
        return true;
      } else {
        return false;
      }
    },
    closeStream(stream) {
      if (!stream) {
        return;
      }

      if (stream.getTracks()) {
        const tracks = stream.getTracks();
        tracks.forEach((track) => {
          track.stop();
        });
      } else {
        const audioTracks = stream.getAudioTracks();
        audioTracks.forEach((track) => {
          track.stop();
        });
        const videoTracks = stream.getVideoTracks();
        videoTracks.forEach((track) => {
          track.stop();
        });
      }
    },
    getDateTime(today) {
      var year = today.getFullYear();
      var month = (today.getMonth() + 1).toString().padStart(2, "0");
      var day = today.getDate().toString().padStart(2, "0");
      var hours = today.getHours().toString().padStart(2, "0");
      var minutes = today.getMinutes().toString().padStart(2, "0");
      var seconds = today.getSeconds().toString().padStart(2, "0");
      return (dateStr =
        year +
        "-" +
        month +
        "-" +
        day +
        " " +
        hours +
        "-" +
        minutes +
        "-" +
        seconds);
    },
    getDateTime1(today) {
      var year = today.getFullYear();
      var month = (today.getMonth() + 1).toString().padStart(2, "0");
      var day = today.getDate().toString().padStart(2, "0");
      var hours = today.getHours().toString().padStart(2, "0");
      var minutes = today.getMinutes().toString().padStart(2, "0");
      var seconds = today.getSeconds().toString().padStart(2, "0");
      return (dateStr =
        year +
        "-" +
        month +
        "-" +
        day +
        " " +
        hours +
        ":" +
        minutes +
        ":" +
        seconds);
    },
    async getVideoMaxFps() {
      let _this = this;
      const devices = await navigator.mediaDevices.enumerateDevices();
      _this.videoConstraints.video.deviceId = _this.videoDevice;

      navigator.mediaDevices
        .getUserMedia(_this.videoConstraints)
        .then((mediaStream) => {
          const videoTrack = mediaStream.getVideoTracks()[0];
          const capabilities = videoTrack.getCapabilities();
          log.info("Supported frame rates:", capabilities.frameRate);
          log.info("Current settings:", videoTrack.getSettings());
          _this.ratio = capabilities.frameRate.max;
          let fps = _this.ratio;
          _this.ratios = [];
          for (let i = 0; i <= fps; i++) {
            if (fps < 5) {
              break;
            }
            _this.ratios.push(fps);
            fps -= 5;
          }
          _this.closeStream(mediaStream);
        })
        .catch((error) => {
          log.info("Failed to access camera:", error);
        });
    },
  },
  watch: {
    fileData() {
      layui.use("table", () => {
        const table = layui.table;
        table.reload("tab", {
          data: this.fileData,
        });
      });
    },
  },
});

layui.use(["layer", "form", "table"], function () {
  let _this = app; //获取Vue对象

  let layer = layui.layer;
  let form = layui.form;
  let table = layui.table;

  form.render(); // 渲染全部

  // 监听 select 改变事件
  form.on("select(videoDeviceChange)", function (data) {
    _this.videoDevice = data.value;
  });

  form.on("select(audioDeviceChange)", function (data) {
    _this.audioDevice = data.value;
  });

  form.on("select(frameRateChange)", function (data) {
    _this.frameRate = data.value;
  });

  form.on("select(ratioChange)", function (data) {
    _this.ratio = data.value;
  });

  //第一个实例
  table.render({
    elem: "#tab",
    height: 300,
    url: "", //数据接口
    page: true, //开启分页
    skin: "nob", //行边框风格
    cols: [
      [
        //表头
        { field: "fileName", title: "文件名", width: 400 },
        { field: "fileSize", title: "文件大小", width: 200 },
        { field: "mtime", title: "完成时间", width: 300 },
        { fixed: "right", width: 200, align: "center", toolbar: "#barDemo" },
      ],
    ],
    data: _this.fileData,
  });

  //监听行工具事件
  table.on("tool(tabFilter)", function (obj) {
    //注：tool 是工具条事件名，test 是 table 原始容器的属性 lay-filter="对应的值"
    let data = obj.data, //获得当前行数据
      layEvent = obj.event; //获得 lay-event 对应的值
    let fPath = _this.filepath + data.fileName;
    log.info(fPath);
    if (layEvent === "detail") {
      layer.msg("正在打开播放器");

      // Get the default player for Windows
      const player = spawn("cmd", ["/c", "start", "", path.resolve(fPath)]);

      // Handle any errors that occur
      player.on("error", (err) => {
        console.error(`Failed to open default player: ${err}`);
      });
    } else if (layEvent === "open") {
      layer.msg("打开文件所在位置");
      const { exec } = require("child_process");
      if (process.platform == "darwin") {
        // macOS
        exec(`open -R "${fPath}"`);
      } else if (process.platform == "win32") {
        // Windows
        exec(`explorer /select,"${fPath}"`);
      }
    } else if (layEvent === "del") {
      layer.confirm(
        "确定要删除吗？",
        { icon: 3, title: "提示" },
        function (index) {
          // 点击确认按钮的回调函数
          fs.unlink(fPath, (err) => {
            if (err) {
              log.info("垃圾文件" + fPath + "删除失败！");
            }
            log.info("文件已成功删除！");
            // 找到对象的索引
            const index = _this.fileData.findIndex(
              (obj) => obj.fileName === data.fileName
            );

            // 如果找到了该对象，则从数组中删除它
            if (index !== -1) {
              _this.fileData.splice(index, 1);
            }
          });
          layer.close(index); // 关闭确认提示框
        },
        function () {
          // 点击取消按钮的回调函数
          layer.closeAll();
        }
      );
    }
  });
});
