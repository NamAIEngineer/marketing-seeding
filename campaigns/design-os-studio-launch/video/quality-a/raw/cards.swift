import Foundation
import AppKit
import CoreGraphics
import CoreText
import ImageIO
import UniformTypeIdentifiers
let args=CommandLine.arguments; guard args.count >= 4 else { exit(2) }
let out=URL(fileURLWithPath:args[1]); let pill=args[2]; let headline=args[3]
let w=1280,h=720; let cs=CGColorSpace(name: CGColorSpace.sRGB)!; let ctx=CGContext(data:nil,width:w,height:h,bitsPerComponent:8,bytesPerRow:w*4,space:cs,bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue)!; ctx.setFillColor(CGColor(red:CGFloat(0x12)/255,green:CGFloat(0x11)/255,blue:CGFloat(0x14)/255,alpha:1));ctx.fill(CGRect(x:0,y:0,width:w,height:h))
func text(_ s:String,x:CGFloat,y:CGFloat,size:CGFloat,color:CGColor){let f=CTFontCreateWithName("Helvetica Neue" as CFString,size,nil);let a:[NSAttributedString.Key:Any]=[kCTFontAttributeName as NSAttributedString.Key:f,kCTForegroundColorAttributeName as NSAttributedString.Key:color];let line=CTLineCreateWithAttributedString(NSAttributedString(string:s,attributes:a));ctx.textPosition=CGPoint(x:x,y:y);CTLineDraw(line,ctx)}
ctx.setFillColor(CGColor(red:CGFloat(0xE2)/255,green:CGFloat(0x61)/255,blue:CGFloat(0x22)/255,alpha:1));ctx.fill(CGRect(x:160,y:650,width:210,height:38));text(pill,x:176,y:662,size:20,color:CGColor(gray:0.07,alpha:1));text(headline,x:160,y:600,size:40,color:CGColor(red:CGFloat(0xF3)/255,green:CGFloat(0xF2)/255,blue:CGFloat(0xF5)/255,alpha:1));ctx.setStrokeColor(CGColor(red:0.40,green:0.72,blue:0.95,alpha:1));ctx.setLineWidth(2);ctx.stroke(CGRect(x:160,y:30,width:960,height:580));let img=ctx.makeImage()!;let dest=CGImageDestinationCreateWithURL(out as CFURL,UTType.png.identifier as CFString,1,nil)!;CGImageDestinationAddImage(dest,img,nil);CGImageDestinationFinalize(dest)
