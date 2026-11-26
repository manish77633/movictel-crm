export default {
  devIndicators: false,
  async rewrites() {
    const api = process.env.API_ORIGIN || 'http://127.0.0.1:4000'
    return [
      { source: '/api/:path*', destination: api + '/api/:path*' },
      { source: '/socket.io', destination: api + '/socket.io/' },
    ]
  },
}
