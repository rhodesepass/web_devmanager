# syntax=docker/dockerfile-upstream:master-labs
# 裁剪版 ffmpeg core：只保留 devman_web 素材导出用到的组件
# （y4m/concat/mov 解封装、mp4 封装、libx264 编码、rawvideo/h264 解码、
#   scale/format/deband/noise 滤镜、file 协议），外部库只留 x264。

FROM emscripten/emsdk:3.1.40 AS emsdk-base
ARG EXTRA_CFLAGS
ARG EXTRA_LDFLAGS
ARG FFMPEG_ST
ARG FFMPEG_MT
ENV INSTALL_DIR=/opt
ENV FFMPEG_VERSION=n5.1.4
ENV CFLAGS="-I$INSTALL_DIR/include $CFLAGS $EXTRA_CFLAGS"
ENV CXXFLAGS="$CFLAGS"
ENV LDFLAGS="-L$INSTALL_DIR/lib $LDFLAGS $CFLAGS $EXTRA_LDFLAGS"
ENV EM_PKG_CONFIG_PATH=$EM_PKG_CONFIG_PATH:$INSTALL_DIR/lib/pkgconfig:/emsdk/upstream/emscripten/system/lib/pkgconfig
ENV EM_TOOLCHAIN_FILE=$EMSDK/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake
ENV PKG_CONFIG_PATH=$PKG_CONFIG_PATH:$EM_PKG_CONFIG_PATH
ENV FFMPEG_ST=$FFMPEG_ST
ENV FFMPEG_MT=$FFMPEG_MT
RUN apt-get update && \
      apt-get install -y pkg-config autoconf automake libtool ragel

# Build x264
FROM emsdk-base AS x264-builder
ENV X264_BRANCH=4-cores
ADD https://github.com/ffmpegwasm/x264.git#$X264_BRANCH /src
COPY build/x264.sh /src/build.sh
RUN bash -x /src/build.sh

# Base ffmpeg image
FROM emsdk-base AS ffmpeg-base
RUN embuilder build sdl2 sdl2-mt
ADD https://github.com/FFmpeg/FFmpeg.git#$FFMPEG_VERSION /src
COPY --from=x264-builder $INSTALL_DIR $INSTALL_DIR

# Build ffmpeg（组件白名单）
FROM ffmpeg-base AS ffmpeg-builder
COPY build/ffmpeg.sh /src/build.sh
RUN bash -x /src/build.sh \
      --enable-gpl \
      --enable-libx264 \
      --disable-everything \
      --disable-network \
      --disable-indevs \
      --disable-outdevs \
      --enable-protocol=file \
      --enable-demuxer=yuv4mpegpipe,concat,mov \
      --enable-muxer=mp4 \
      --enable-encoder=libx264 \
      --enable-decoder=rawvideo,h264 \
      --enable-parser=h264 \
      --enable-bsf=h264_mp4toannexb,extract_extradata \
      --enable-filter=buffer,buffersink,scale,format,deband,noise,fps,null,copy,settb,setpts,trim

# Build ffmpeg.wasm
FROM ffmpeg-builder AS ffmpeg-wasm-builder
COPY src/bind /src/src/bind
COPY src/fftools /src/src/fftools
COPY build/ffmpeg-wasm.sh build.sh
ENV FFMPEG_LIBS -lx264
RUN mkdir -p /src/dist/umd && bash -x /src/build.sh \
      ${FFMPEG_LIBS} \
      -o dist/umd/ffmpeg-core.js
RUN mkdir -p /src/dist/esm && bash -x /src/build.sh \
      ${FFMPEG_LIBS} \
      -sEXPORT_ES6 \
      -o dist/esm/ffmpeg-core.js

FROM scratch AS exportor
COPY --from=ffmpeg-wasm-builder /src/dist /dist
